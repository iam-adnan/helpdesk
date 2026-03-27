import logging
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

try:
    from slack_sdk import WebClient
    SLACK_OK = True
except ImportError:
    SLACK_OK = False


def get_client():
    token = getattr(settings, 'SLACK_BOT_TOKEN', '').strip()
    if not token or not SLACK_OK:
        return None
    return WebClient(token=token)


def _pri_emoji(p):
    return {'critical': '🔴', 'high': '🟠', 'medium': '🟡', 'low': '🟢'}.get(p, '⚪')


def _status_emoji(s):
    return {'open': '📬', 'in_progress': '🔧', 'pending': '⏳', 'resolved': '✅', 'closed': '🔒'}.get(s, '📋')


def _ticket_url(ticket):
    base = getattr(settings, 'FRONTEND_URL', 'http://localhost').rstrip('/')
    return f'{base}/tickets/{ticket.id}'


# ─────────────────────────────────────────────────────────────────────────────
# Slash command → open modal
# ─────────────────────────────────────────────────────────────────────────────

def open_ticket_modal(user_slack_id, user_email, trigger_id):
    """
    Called when user types /helpdesk.
    Opens a modal form. Passes email in private_metadata so submission can find the user.
    """
    client = get_client()
    if not client:
        logger.error('Slack client not configured - check SLACK_BOT_TOKEN in .env')
        return {'response_type': 'ephemeral', 'text': '❌ Slack integration not configured. Contact IT admin.'}

    # If Slack didn't send email (rare), fetch it from API
    if not user_email:
        try:
            r = client.users_info(user=user_slack_id)
            user_email = r['user']['profile'].get('email', '')
            logger.info(f'Fetched email from Slack API: {user_email}')
        except Exception as e:
            logger.error(f'Could not fetch email from Slack API: {e}')

    logger.info(f'Opening modal for user_email={user_email} slack_id={user_slack_id}')

    modal = {
        'type': 'modal',
        'callback_id': 'raise_ticket',
        'private_metadata': user_email,  # Pass email through to submission
        'title': {'type': 'plain_text', 'text': 'Raise a ticket', 'emoji': True},
        'submit': {'type': 'plain_text', 'text': 'Submit a ticket', 'emoji': True},
        'close': {'type': 'plain_text', 'text': 'Cancel', 'emoji': True},
        'blocks': [
            {
                'type': 'input',
                'block_id': 'subject_block',
                'label': {'type': 'plain_text', 'text': 'Subject'},
                'element': {
                    'type': 'plain_text_input',
                    'action_id': 'subject_input',
                    'placeholder': {'type': 'plain_text', 'text': 'Brief summary of the issue'},
                    'max_length': 200,
                }
            },
            {
                'type': 'input',
                'block_id': 'description_block',
                'optional': True,
                'label': {'type': 'plain_text', 'text': 'Description (optional)'},
                'element': {
                    'type': 'plain_text_input',
                    'action_id': 'description_input',
                    'multiline': True,
                    'placeholder': {'type': 'plain_text', 'text': 'Describe the issue in detail'},
                }
            },
            {
                'type': 'input',
                'block_id': 'category_block',
                'label': {'type': 'plain_text', 'text': 'Category'},
                'element': {
                    'type': 'static_select',
                    'action_id': 'category_input',
                    'placeholder': {'type': 'plain_text', 'text': 'Select a category'},
                    'options': [
                        {'text': {'type': 'plain_text', 'text': 'Problem / Other'}, 'value': 'other'},
                        {'text': {'type': 'plain_text', 'text': 'Hardware'}, 'value': 'hardware'},
                        {'text': {'type': 'plain_text', 'text': 'Software'}, 'value': 'software'},
                        {'text': {'type': 'plain_text', 'text': 'Network'}, 'value': 'network'},
                        {'text': {'type': 'plain_text', 'text': 'Access / Permissions'}, 'value': 'access'},
                        {'text': {'type': 'plain_text', 'text': 'Email'}, 'value': 'email'},
                    ]
                }
            },
            {
                'type': 'input',
                'block_id': 'priority_block',
                'label': {'type': 'plain_text', 'text': 'Priority'},
                'element': {
                    'type': 'static_select',
                    'action_id': 'priority_input',
                    'placeholder': {'type': 'plain_text', 'text': 'Select priority'},
                    'options': [
                        {'text': {'type': 'plain_text', 'text': 'Critical'}, 'value': 'critical'},
                        {'text': {'type': 'plain_text', 'text': 'High'}, 'value': 'high'},
                        {'text': {'type': 'plain_text', 'text': 'Medium'}, 'value': 'medium'},
                        {'text': {'type': 'plain_text', 'text': 'Low'}, 'value': 'low'},
                    ]
                }
            },
            {
                'type': 'input',
                'block_id': 'support_block',
                'label': {'type': 'plain_text', 'text': 'Support team'},
                'element': {
                    'type': 'static_select',
                    'action_id': 'support_input',
                    'placeholder': {'type': 'plain_text', 'text': 'Select team'},
                    'options': [
                        {'text': {'type': 'plain_text', 'text': 'IT'}, 'value': 'IT'},
                    ]
                }
            },
        ]
    }

    try:
        client.views_open(trigger_id=trigger_id, view=modal)
        logger.info('Modal opened successfully')
        return None  # None = no response needed, modal is open
    except Exception as e:
        logger.error(f'views_open failed: {e}')
        return {'response_type': 'ephemeral', 'text': f'Failed to open form: {e}'}


# ─────────────────────────────────────────────────────────────────────────────
# Modal submission → create ticket
# ─────────────────────────────────────────────────────────────────────────────

def process_modal_submission(payload):
    """
    Called when user clicks Submit on the modal.
    Creates a ticket and sends a DM confirmation.
    Returns None on success, error string on failure.
    """
    from helpdesk.models import User, Ticket, TicketHistory
    from helpdesk.services import apply_sla, apply_auto_assignment

    # Extract user identity
    user_email = payload['view'].get('private_metadata', '').strip()
    slack_user_id = payload['user']['id']

    logger.info(f'Modal submitted by email={user_email} slack_id={slack_user_id}')

    # Extract form values
    values = payload['view']['state']['values']
    logger.info(f'Form values received: {list(values.keys())}')

    title = (values.get('subject_block', {}).get('subject_input', {}).get('value') or '').strip()
    description = (values.get('description_block', {}).get('description_input', {}).get('value') or '').strip() or title

    category_sel = values.get('category_block', {}).get('category_input', {}).get('selected_option')
    category = category_sel['value'] if category_sel else 'other'

    priority_sel = values.get('priority_block', {}).get('priority_input', {}).get('selected_option')
    priority = priority_sel['value'] if priority_sel else 'medium'

    logger.info(f'Parsed: title="{title}" category={category} priority={priority}')

    if not title:
        return 'Subject is required.'

    # Find user by email
    user = None
    if user_email:
        user = User.objects.filter(email=user_email).first()
        logger.info(f'User lookup by email {user_email}: {"FOUND" if user else "NOT FOUND"}')

    if not user:
        # Try by slack_user_id as fallback
        user = User.objects.filter(slack_user_id=slack_user_id).first()
        if user:
            logger.info(f'Found user by slack_user_id: {user.email}')

    if not user:
        error_msg = f'No helpdesk account found for {user_email}. Please register at the helpdesk portal first.'
        logger.warning(error_msg)
        # Send error DM
        _send_error_dm(slack_user_id, user_email)
        return error_msg

    # Save slack_user_id for future DMs
    if slack_user_id and not user.slack_user_id:
        user.slack_user_id = slack_user_id
        user.save(update_fields=['slack_user_id'])
        logger.info(f'Saved slack_user_id {slack_user_id} for {user.email}')

    # Create ticket
    try:
        ticket = Ticket.objects.create(
            title=title,
            description=description,
            category=category,
            priority=priority,
            created_by=user,
            source='slack',
        )
        TicketHistory.objects.create(ticket=ticket, user=user, action='created', new_value='open')
        apply_sla(ticket)
        apply_auto_assignment(ticket)
        ticket.refresh_from_db()
        logger.info(f'Ticket created: {ticket.ticket_number}')
    except Exception as e:
        logger.error(f'Ticket creation failed: {e}', exc_info=True)
        return f'Failed to create ticket: {e}'

    # Post to IT channel
    try:
        ts, thread_ts = post_to_channel(ticket)
        if ts:
            ticket.slack_channel_ts = ts
            ticket.slack_thread_ts = thread_ts
            ticket.save(update_fields=['slack_channel_ts', 'slack_thread_ts'])
    except Exception as e:
        logger.error(f'Post to channel failed: {e}')

    # DM the user
    try:
        send_dm(user, ticket, 'created')
    except Exception as e:
        logger.error(f'DM failed: {e}')

    logger.info(f'Done: ticket {ticket.ticket_number} created for {user.email}')
    return None  # None = success


def _send_error_dm(slack_user_id, user_email):
    client = get_client()
    if not client:
        return
    try:
        frontend = getattr(settings, 'FRONTEND_URL', 'http://mindstorm-helpdesk.duckdns.org')
        dm = client.conversations_open(users=[slack_user_id])
        client.chat_postMessage(
            channel=dm['channel']['id'],
            text=(
                f':x: Could not find a helpdesk account for *{user_email}*.\n\n'
                f'Please register at {frontend} using your Mindstorm email, then try again.'
            )
        )
    except Exception as e:
        logger.error(f'Error DM failed: {e}')


# ─────────────────────────────────────────────────────────────────────────────
# Channel + DM notifications
# ─────────────────────────────────────────────────────────────────────────────

def post_to_channel(ticket):
    client = get_client()
    channel = getattr(settings, 'SLACK_IT_CHANNEL', '').strip()
    if not client or not channel:
        return None, None
    try:
        r = client.chat_postMessage(
            channel=channel,
            blocks=_ticket_blocks(ticket),
            text=f'New ticket: {ticket.ticket_number} — {ticket.title}',
            unfurl_links=False,
        )
        logger.info(f'Posted ticket {ticket.ticket_number} to {channel}')
        return r['ts'], r['ts']
    except Exception as e:
        logger.error(f'Post to channel failed: {e}')
        return None, None


def update_channel_message(ticket, event='status'):
    client = get_client()
    channel = getattr(settings, 'SLACK_IT_CHANNEL', '').strip()
    if not client or not channel or not ticket.slack_channel_ts:
        return
    try:
        client.chat_update(
            channel=channel, ts=ticket.slack_channel_ts,
            blocks=_ticket_blocks(ticket),
            text=f'Updated: {ticket.ticket_number}',
        )
    except Exception as e:
        logger.error(f'Channel update failed: {e}')


def post_thread_update(ticket, message):
    client = get_client()
    channel = getattr(settings, 'SLACK_IT_CHANNEL', '').strip()
    if not client or not channel or not ticket.slack_thread_ts:
        return
    try:
        client.chat_postMessage(channel=channel, thread_ts=ticket.slack_thread_ts, text=message)
    except Exception as e:
        logger.error(f'Thread update failed: {e}')


def send_dm(user, ticket, event, extra_text=''):
    """
    Send DM to user. Looks up their Slack account by email automatically.
    No Slack ID configuration needed from users.
    """
    client = get_client()
    if not client:
        return False

    url = _ticket_url(ticket)

    # Get or find DM channel
    dm_channel = user.slack_dm_channel

    if not dm_channel:
        # Look up by email
        slack_user_id = user.slack_user_id
        if not slack_user_id:
            try:
                r = client.users_lookupByEmail(email=user.email)
                slack_user_id = r['user']['id']
                user.slack_user_id = slack_user_id
                user.save(update_fields=['slack_user_id'])
                logger.info(f'Found Slack user by email {user.email}: {slack_user_id}')
            except Exception as e:
                logger.warning(f'Could not find Slack user for {user.email}: {e}')
                return False

        try:
            r = client.conversations_open(users=[slack_user_id])
            dm_channel = r['channel']['id']
            user.slack_dm_channel = dm_channel
            user.save(update_fields=['slack_dm_channel'])
        except Exception as e:
            logger.error(f'Could not open DM for {user.email}: {e}')
            return False

    messages = {
        'created': (
            f':ticket: *Your IT ticket has been received!*\n\n'
            f'*<{url}|{ticket.ticket_number}: {ticket.title}>*\n'
            f'Priority: {_pri_emoji(ticket.priority)} {ticket.priority.capitalize()}\n'
            f'Category: {ticket.get_category_display()}\n\n'
            f'Our IT team will get back to you shortly.'
        ),
        'status_changed': (
            f'{_status_emoji(ticket.status)} *Ticket status updated*\n'
            f'*<{url}|{ticket.ticket_number}>* is now *{ticket.get_status_display()}*.'
            + (f'\n{extra_text}' if extra_text else '')
        ),
        'comment': (
            f':speech_balloon: *New reply on your ticket*\n'
            f'*<{url}|{ticket.ticket_number}: {ticket.title}>*\n'
            f'_{extra_text}_'
        ),
        'resolved': (
            f':white_check_mark: *Ticket resolved!*\n'
            f'*<{url}|{ticket.ticket_number}>* has been resolved.\n'
            f'If the issue persists, reopen it from the helpdesk portal.'
        ),
        'assigned': (
            f':bust_in_silhouette: *Ticket assigned*\n'
            f'*<{url}|{ticket.ticket_number}>* assigned to '
            f'*{ticket.assigned_to.display_name() if ticket.assigned_to else "IT Team"}*.'
        ),
    }

    try:
        client.chat_postMessage(
            channel=dm_channel,
            text=messages.get(event, f'Update on ticket {ticket.ticket_number}'),
            unfurl_links=False,
        )
        logger.info(f'DM sent to {user.email} for event={event}')
        return True
    except Exception as e:
        logger.error(f'DM failed to {user.email}: {e}')
        # Reset cached DM channel so it retries next time
        user.slack_dm_channel = None
        user.save(update_fields=['slack_dm_channel'])
        return False


def _ticket_blocks(ticket):
    url = _ticket_url(ticket)
    assignee = ticket.assigned_to.display_name() if ticket.assigned_to else 'Unassigned'
    sla_text = ''
    if ticket.sla_resolve_due and ticket.status not in ('resolved', 'closed'):
        diff = ticket.sla_resolve_due - timezone.now()
        sla_text = f'\n:alarm_clock: SLA: {int(diff.total_seconds()/3600)}h remaining' if diff.total_seconds() > 0 else '\n:rotating_light: SLA BREACHED'

    return [
        {'type': 'section', 'text': {'type': 'mrkdwn', 'text': (
            f'*<{url}|{ticket.ticket_number}: {ticket.title}>*\n'
            f'{ticket.description[:280]}{"..." if len(ticket.description) > 280 else ""}'
        )}},
        {'type': 'section', 'fields': [
            {'type': 'mrkdwn', 'text': f'*Status:*\n{_status_emoji(ticket.status)} {ticket.get_status_display()}'},
            {'type': 'mrkdwn', 'text': f'*Priority:*\n{_pri_emoji(ticket.priority)} {ticket.priority.capitalize()}'},
            {'type': 'mrkdwn', 'text': f'*Category:*\n{ticket.get_category_display()}'},
            {'type': 'mrkdwn', 'text': f'*Assignee:*\n{assignee}'},
            {'type': 'mrkdwn', 'text': f'*Requester:*\n{ticket.created_by.display_name()}'},
            {'type': 'mrkdwn', 'text': f'*Ticket #:*\n`{ticket.ticket_number}`{sla_text}'},
        ]},
        {'type': 'actions', 'elements': [
            {'type': 'button', 'text': {'type': 'plain_text', 'text': 'View Ticket', 'emoji': True},
             'url': url, 'style': 'primary'}
        ]},
        {'type': 'divider'},
    ]


def send_digest(period='daily'):
    client = get_client()
    channel = getattr(settings, 'SLACK_IT_CHANNEL', '').strip()
    if not client or not channel:
        return
    from helpdesk.models import Ticket
    now = timezone.now()
    open_c = Ticket.objects.filter(status='open').count()
    prog_c = Ticket.objects.filter(status='in_progress').count()
    breach_c = Ticket.objects.filter(sla_resolve_breached=True, status__in=['open', 'in_progress']).count()
    crit_c = Ticket.objects.filter(priority='critical', status__in=['open', 'in_progress']).count()
    recent = Ticket.objects.filter(status='open').order_by('-created_at')[:5]
    lines = '\n'.join([f'• <{_ticket_url(t)}|{t.ticket_number}> — {t.title[:55]}' for t in recent]) or '_No open tickets_'
    try:
        client.chat_postMessage(
            channel=channel,
            text=f'IT Digest: {open_c} open tickets',
            blocks=[
                {'type': 'header', 'text': {'type': 'plain_text', 'text': f'IT Digest — {now.strftime("%b %d, %Y")}'}},
                {'type': 'section', 'fields': [
                    {'type': 'mrkdwn', 'text': f'*Open:* {open_c}'},
                    {'type': 'mrkdwn', 'text': f'*In Progress:* {prog_c}'},
                    {'type': 'mrkdwn', 'text': f'*SLA Breached:* {breach_c}'},
                    {'type': 'mrkdwn', 'text': f'*Critical:* {crit_c}'},
                ]},
                {'type': 'section', 'text': {'type': 'mrkdwn', 'text': f'*Recent open:*\n{lines}'}},
            ]
        )
    except Exception as e:
        logger.error(f'Digest failed: {e}')


# Keep old names for backward compat
def handle_slash_command(user_slack_id, user_email, trigger_id):
    return open_ticket_modal(user_slack_id, user_email, trigger_id)


def handle_modal_submission(payload):
    return process_modal_submission(payload)


def handle_thread_reply(thread_ts, user_slack_id, text):
    from helpdesk.models import Ticket, Comment, User
    if not text or not text.strip():
        return False
    try:
        ticket = Ticket.objects.get(slack_thread_ts=thread_ts)
        user = User.objects.filter(slack_user_id=user_slack_id).first()
        if not user:
            return False
        Comment.objects.create(ticket=ticket, user=user, content=text, source='slack')
        ticket.save(update_fields=['updated_at'])
        return True
    except Ticket.DoesNotExist:
        return False
