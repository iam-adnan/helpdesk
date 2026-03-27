import logging
from datetime import timedelta
from django.utils import timezone
from django.conf import settings

logger = logging.getLogger(__name__)


def apply_sla(ticket):
    from helpdesk.models import SLAPolicy
    try:
        policy = SLAPolicy.objects.get(priority=ticket.priority, is_active=True)
        now = timezone.now()
        ticket.sla_policy = policy
        ticket.sla_response_due = now + timedelta(hours=policy.response_hours)
        ticket.sla_resolve_due = now + timedelta(hours=policy.resolve_hours)
        ticket.save(update_fields=['sla_policy', 'sla_response_due', 'sla_resolve_due'])
    except SLAPolicy.DoesNotExist:
        pass


def apply_auto_assignment(ticket):
    from helpdesk.models import AutoAssignRule, TicketHistory
    try:
        rule = AutoAssignRule.objects.get(category=ticket.category, is_active=True)
        if rule.assign_to:
            ticket.assigned_to = rule.assign_to
            ticket.save(update_fields=['assigned_to'])
            TicketHistory.objects.create(
                ticket=ticket, user=rule.assign_to,
                action='auto_assigned', new_value=rule.assign_to.display_name()
            )
    except AutoAssignRule.DoesNotExist:
        pass


def notify_ticket_event(ticket, event, actor=None, extra_text=''):
    try:
        from helpdesk.slack_service import (
            post_ticket_to_channel, send_dm_to_user,
            update_channel_message, post_thread_update
        )
        from helpdesk.models import NotificationLog

        if event == 'created':
            ts, thread_ts = post_ticket_to_channel(ticket)
            if ts:
                ticket.slack_channel_ts = ts
                ticket.slack_thread_ts = thread_ts
                ticket.save(update_fields=['slack_channel_ts', 'slack_thread_ts'])
            sent = send_dm_to_user(ticket.created_by, ticket, 'created')
            NotificationLog.objects.create(
                ticket=ticket, recipient=ticket.created_by,
                channel='slack', event='created',
                status='sent' if sent else 'skipped'
            )
        else:
            update_channel_message(ticket, event)
            thread_messages = {
                'status_changed': f'Status → *{ticket.get_status_display()}*' + (f' by {actor.display_name()}' if actor else ''),
                'assigned': f'Assigned to *{ticket.assigned_to.display_name() if ticket.assigned_to else "Unassigned"}*',
                'comment': f'New reply: {extra_text[:200]}',
                'resolved': f'Ticket resolved ✅',
                'priority_changed': f'Priority → *{ticket.priority}*',
            }
            msg = thread_messages.get(event)
            if msg:
                post_thread_update(ticket, msg)

            requester = ticket.created_by
            if actor and requester != actor and event in ('status_changed', 'comment', 'resolved', 'assigned'):
                sent = send_dm_to_user(requester, ticket, event, extra_text)
                NotificationLog.objects.create(
                    ticket=ticket, recipient=requester,
                    channel='slack', event=event,
                    status='sent' if sent else 'skipped'
                )
    except Exception as e:
        logger.error(f'Notification error [{event}] ticket {ticket.ticket_number}: {e}')


def check_sla_breaches():
    from helpdesk.models import Ticket
    from helpdesk.slack_service import get_slack_client
    now = timezone.now()
    client = get_slack_client()
    channel = getattr(settings, 'SLACK_IT_CHANNEL', '')

    for ticket in Ticket.objects.filter(
        sla_response_due__lt=now, sla_response_breached=False,
        first_response_at__isnull=True, status__in=['open', 'in_progress']
    ):
        ticket.sla_response_breached = True
        ticket.save(update_fields=['sla_response_breached'])
        if client and channel and ticket.slack_thread_ts:
            try:
                client.chat_postMessage(
                    channel=channel, thread_ts=ticket.slack_thread_ts,
                    text=f'⚠️ *SLA Response Breach* — {ticket.ticket_number} has not received a first response within SLA.'
                )
            except Exception as e:
                logger.error(f'SLA breach alert failed: {e}')

    for ticket in Ticket.objects.filter(
        sla_resolve_due__lt=now, sla_resolve_breached=False,
        status__in=['open', 'in_progress', 'pending']
    ):
        ticket.sla_resolve_breached = True
        ticket.save(update_fields=['sla_resolve_breached'])
        if client and channel and ticket.slack_thread_ts:
            try:
                mention = f'<@{ticket.assigned_to.slack_user_id}>' if (ticket.assigned_to and ticket.assigned_to.slack_user_id) else 'Team'
                client.chat_postMessage(
                    channel=channel, thread_ts=ticket.slack_thread_ts,
                    text=f'🚨 *SLA Resolution Breach* {mention} — {ticket.ticket_number} needs immediate attention.'
                )
            except Exception as e:
                logger.error(f'SLA resolve breach alert failed: {e}')
