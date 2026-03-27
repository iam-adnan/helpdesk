import json
import hashlib
import hmac
import logging
from django.utils import timezone
from django.db.models import Count
from django.conf import settings
from django.http import JsonResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (Ticket, Comment, TicketHistory, User, Attachment,
                     TicketLink, SLAPolicy, AutoAssignRule, CannedResponse, NotificationLog)
from .serializers import (TicketListSerializer, TicketDetailSerializer,
                          CommentSerializer, UserSerializer, AttachmentSerializer,
                          TicketLinkSerializer, SLAPolicySerializer,
                          AutoAssignRuleSerializer, CannedResponseSerializer, NotificationLogSerializer)
from .permissions import IsAdminUser
from .services import apply_sla, apply_auto_assignment, notify_ticket_event

logger = logging.getLogger(__name__)


# ── Tickets ───────────────────────────────────────────────────────────────────

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def ticket_list_create(request):
    if request.method == 'GET':
        if request.user.is_admin:
            qs = Ticket.objects.select_related('created_by', 'assigned_to', 'sla_policy').all()
        else:
            qs = Ticket.objects.select_related('created_by', 'assigned_to', 'sla_policy').filter(created_by=request.user)
        return Response(TicketListSerializer(qs, many=True).data)

    title = request.data.get('title', '').strip()
    description = request.data.get('description', '').strip()
    if not title or not description:
        return Response({'error': 'Title and description are required.'}, status=400)

    ticket = Ticket.objects.create(
        title=title,
        description=description,
        category=request.data.get('category', 'other'),
        priority=request.data.get('priority', 'medium'),
        created_by=request.user,
        source=request.data.get('source', 'web'),
    )
    TicketHistory.objects.create(ticket=ticket, user=request.user, action='created', new_value='open')
    apply_sla(ticket)
    apply_auto_assignment(ticket)
    ticket.refresh_from_db()
    notify_ticket_event(ticket, 'created')
    return Response(TicketListSerializer(ticket).data, status=201)


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def ticket_detail(request, pk):
    try:
        ticket = Ticket.objects.select_related('created_by', 'assigned_to', 'sla_policy').get(pk=pk)
    except Ticket.DoesNotExist:
        return Response({'error': 'Ticket not found.'}, status=404)

    if not request.user.is_admin and ticket.created_by != request.user:
        return Response({'error': 'Access denied.'}, status=403)

    if request.method == 'GET':
        return Response(TicketDetailSerializer(ticket, context={'request': request}).data)

    old_status = ticket.status
    old_priority = ticket.priority
    old_assigned = ticket.assigned_to_id
    event = None

    allowed_fields = ['title', 'description', 'category', 'priority', 'status', 'assigned_to']
    if not request.user.is_admin:
        allowed_fields = ['title', 'description', 'category']

    for field in allowed_fields:
        if field in request.data:
            val = request.data[field]
            if field == 'assigned_to':
                if val:
                    try:
                        ticket.assigned_to = User.objects.get(pk=val)
                    except User.DoesNotExist:
                        pass
                else:
                    ticket.assigned_to = None
            else:
                setattr(ticket, field, val)

    ticket.save()

    if request.user.is_admin:
        if ticket.status != old_status:
            TicketHistory.objects.create(ticket=ticket, user=request.user, action='status_changed', old_value=old_status, new_value=ticket.status)
            if ticket.status == 'resolved' and not ticket.resolved_at:
                ticket.resolved_at = timezone.now()
                ticket.save(update_fields=['resolved_at'])
            event = 'resolved' if ticket.status == 'resolved' else 'status_changed'

        if ticket.priority != old_priority:
            TicketHistory.objects.create(ticket=ticket, user=request.user, action='priority_changed', old_value=old_priority, new_value=ticket.priority)
            apply_sla(ticket)
            ticket.refresh_from_db()
            event = event or 'priority_changed'

        if ticket.assigned_to_id != old_assigned:
            TicketHistory.objects.create(ticket=ticket, user=request.user, action='assigned', old_value=str(old_assigned), new_value=str(ticket.assigned_to_id))
            event = event or 'assigned'

        if not ticket.first_response_at and request.user != ticket.created_by:
            ticket.first_response_at = timezone.now()
            ticket.save(update_fields=['first_response_at'])

    if event:
        notify_ticket_event(ticket, event, actor=request.user)

    return Response(TicketListSerializer(ticket).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ticket_comment(request, pk):
    try:
        ticket = Ticket.objects.get(pk=pk)
    except Ticket.DoesNotExist:
        return Response({'error': 'Ticket not found.'}, status=404)

    if not request.user.is_admin and ticket.created_by != request.user:
        return Response({'error': 'Access denied.'}, status=403)

    content = request.data.get('content', '').strip()
    if not content:
        return Response({'error': 'Comment content is required.'}, status=400)

    is_internal = bool(request.user.is_admin and request.data.get('is_internal', False))
    canned_id = request.data.get('canned_response_id')

    if canned_id:
        try:
            cr = CannedResponse.objects.get(pk=canned_id)
            cr.use_count += 1
            cr.save(update_fields=['use_count'])
        except CannedResponse.DoesNotExist:
            pass

    comment = Comment.objects.create(ticket=ticket, user=request.user, content=content, is_internal=is_internal)
    ticket.updated_at = timezone.now()
    ticket.save(update_fields=['updated_at'])

    if not ticket.first_response_at and request.user != ticket.created_by:
        ticket.first_response_at = timezone.now()
        ticket.save(update_fields=['first_response_at'])

    if not is_internal:
        notify_ticket_event(ticket, 'comment', actor=request.user, extra_text=content)

    return Response(CommentSerializer(comment).data, status=201)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def ticket_attachment(request, pk):
    try:
        ticket = Ticket.objects.get(pk=pk)
    except Ticket.DoesNotExist:
        return Response({'error': 'Ticket not found.'}, status=404)

    if not request.user.is_admin and ticket.created_by != request.user:
        return Response({'error': 'Access denied.'}, status=403)

    file = request.FILES.get('file')
    if not file:
        return Response({'error': 'No file provided.'}, status=400)
    if file.size > 20 * 1024 * 1024:
        return Response({'error': 'File too large. Max 20MB.'}, status=400)

    att = Attachment.objects.create(
        ticket=ticket, uploaded_by=request.user,
        file=file, filename=file.name,
        file_size=file.size, mime_type=file.content_type or '',
    )
    return Response(AttachmentSerializer(att, context={'request': request}).data, status=201)


@api_view(['POST'])
@permission_classes([IsAdminUser])
def ticket_merge(request, pk):
    try:
        source = Ticket.objects.get(pk=pk)
        target = Ticket.objects.get(pk=request.data.get('target_id'))
    except Ticket.DoesNotExist:
        return Response({'error': 'Ticket not found.'}, status=404)

    if source.pk == target.pk:
        return Response({'error': 'Cannot merge a ticket into itself.'}, status=400)

    source.merged_into = target
    source.is_merged = True
    source.status = 'closed'
    source.save()

    TicketHistory.objects.create(ticket=source, user=request.user, action='merged_into', new_value=target.ticket_number)
    TicketHistory.objects.create(ticket=target, user=request.user, action='merged_from', new_value=source.ticket_number)
    Comment.objects.filter(ticket=source).update(ticket=target)
    Attachment.objects.filter(ticket=source).update(ticket=target)

    return Response({'success': True, 'target': target.ticket_number})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def ticket_link(request, pk):
    try:
        from_t = Ticket.objects.get(pk=pk)
        to_t = Ticket.objects.get(pk=request.data.get('to_ticket'))
    except Ticket.DoesNotExist:
        return Response({'error': 'Ticket not found.'}, status=404)

    link, created = TicketLink.objects.get_or_create(
        from_ticket=from_t, to_ticket=to_t,
        link_type=request.data.get('link_type', 'related'),
        defaults={'created_by': request.user}
    )
    return Response(TicketLinkSerializer(link).data, status=201 if created else 200)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_stats(request):
    total = Ticket.objects.count()
    return Response({
        'total': total,
        'open': Ticket.objects.filter(status='open').count(),
        'in_progress': Ticket.objects.filter(status='in_progress').count(),
        'pending': Ticket.objects.filter(status='pending').count(),
        'resolved': Ticket.objects.filter(status='resolved').count(),
        'closed': Ticket.objects.filter(status='closed').count(),
        'sla_breached': Ticket.objects.filter(sla_resolve_breached=True, status__in=['open','in_progress','pending']).count(),
        'critical_open': Ticket.objects.filter(priority='critical', status__in=['open','in_progress']).count(),
        'from_slack': Ticket.objects.filter(source='slack').count(),
        'by_priority': list(Ticket.objects.values('priority').annotate(count=Count('id'))),
        'by_category': list(Ticket.objects.values('category').annotate(count=Count('id'))),
        'recent': TicketListSerializer(
            Ticket.objects.select_related('created_by').order_by('-created_at')[:8], many=True
        ).data,
    })


# ── Users ─────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def current_user(request):
    from django.utils import timezone
    request.user.last_login_at = timezone.now()
    request.user.save(update_fields=['last_login_at'])
    return Response(UserSerializer(request.user).data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def update_notification_prefs(request):
    u = request.user
    for field in ['notify_slack', 'notify_email']:
        if field in request.data:
            setattr(u, field, bool(request.data[field]))
    u.save(update_fields=['notify_slack', 'notify_email'])
    return Response(UserSerializer(u).data)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def user_list(request):
    return Response(UserSerializer(User.objects.all().order_by('-date_joined'), many=True).data)


@api_view(['PATCH'])
@permission_classes([IsAdminUser])
def update_user_role(request, pk):
    if str(pk) == str(request.user.pk):
        return Response({'error': 'Cannot change your own role.'}, status=400)
    try:
        u = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'User not found.'}, status=404)
    role = request.data.get('role')
    if role not in ['user', 'admin']:
        return Response({'error': 'Invalid role.'}, status=400)
    u.role = role
    u.is_staff = role == 'admin'
    u.save(update_fields=['role', 'is_staff'])
    return Response({'success': True})


# ── Config (Admin only) ───────────────────────────────────────────────────────

@api_view(['GET', 'POST'])
@permission_classes([IsAdminUser])
def sla_policies(request):
    if request.method == 'GET':
        return Response(SLAPolicySerializer(SLAPolicy.objects.all(), many=True).data)
    s = SLAPolicySerializer(data=request.data)
    if s.is_valid():
        s.save()
        return Response(s.data, status=201)
    return Response(s.errors, status=400)


@api_view(['PUT', 'DELETE'])
@permission_classes([IsAdminUser])
def sla_policy_detail(request, pk):
    try:
        p = SLAPolicy.objects.get(pk=pk)
    except SLAPolicy.DoesNotExist:
        return Response({'error': 'Not found.'}, status=404)
    if request.method == 'DELETE':
        p.delete()
        return Response(status=204)
    s = SLAPolicySerializer(p, data=request.data, partial=True)
    if s.is_valid():
        s.save()
        return Response(s.data)
    return Response(s.errors, status=400)


@api_view(['GET', 'POST'])
@permission_classes([IsAdminUser])
def auto_assign_rules(request):
    if request.method == 'GET':
        return Response(AutoAssignRuleSerializer(AutoAssignRule.objects.select_related('assign_to').all(), many=True).data)
    s = AutoAssignRuleSerializer(data=request.data)
    if s.is_valid():
        s.save()
        return Response(s.data, status=201)
    return Response(s.errors, status=400)


@api_view(['PUT', 'DELETE'])
@permission_classes([IsAdminUser])
def auto_assign_rule_detail(request, pk):
    try:
        r = AutoAssignRule.objects.get(pk=pk)
    except AutoAssignRule.DoesNotExist:
        return Response({'error': 'Not found.'}, status=404)
    if request.method == 'DELETE':
        r.delete()
        return Response(status=204)
    s = AutoAssignRuleSerializer(r, data=request.data, partial=True)
    if s.is_valid():
        s.save()
        return Response(s.data)
    return Response(s.errors, status=400)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def canned_responses(request):
    if request.method == 'GET':
        qs = CannedResponse.objects.all()
        if request.query_params.get('category'):
            qs = qs.filter(category=request.query_params['category'])
        return Response(CannedResponseSerializer(qs, many=True).data)
    if not request.user.is_admin:
        return Response({'error': 'Admin only.'}, status=403)
    s = CannedResponseSerializer(data=request.data)
    if s.is_valid():
        s.save(created_by=request.user)
        return Response(s.data, status=201)
    return Response(s.errors, status=400)


@api_view(['PUT', 'DELETE'])
@permission_classes([IsAdminUser])
def canned_response_detail(request, pk):
    try:
        cr = CannedResponse.objects.get(pk=pk)
    except CannedResponse.DoesNotExist:
        return Response({'error': 'Not found.'}, status=404)
    if request.method == 'DELETE':
        cr.delete()
        return Response(status=204)
    s = CannedResponseSerializer(cr, data=request.data, partial=True)
    if s.is_valid():
        s.save()
        return Response(s.data)
    return Response(s.errors, status=400)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def notification_logs(request):
    qs = NotificationLog.objects.select_related('recipient', 'ticket')
    if request.query_params.get('ticket'):
        qs = qs.filter(ticket_id=request.query_params['ticket'])
    return Response(NotificationLogSerializer(qs[:50], many=True).data)


# ── Slack webhooks ────────────────────────────────────────────────────────────

@csrf_exempt
def slack_events(request):
    if request.method != 'POST':
        return HttpResponse(status=405)
    try:
        body = request.body
        data = json.loads(body)

        if data.get('type') == 'url_verification':
            return JsonResponse({'challenge': data['challenge']})

        secret = getattr(settings, 'SLACK_SIGNING_SECRET', '')
        if secret:
            ts = request.headers.get('X-Slack-Request-Timestamp', '')
            sig = request.headers.get('X-Slack-Signature', '')
            base = f'v0:{ts}:{body.decode()}'
            expected = 'v0=' + hmac.new(secret.encode(), base.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, sig):
                return HttpResponse(status=403)

        event = data.get('event', {})
        if event.get('type') == 'message' and not event.get('bot_id') and event.get('thread_ts'):
            from helpdesk.slack_service import handle_thread_reply
            handle_thread_reply(event['thread_ts'], event.get('user', ''), event.get('text', ''))

        return HttpResponse(status=200)
    except Exception as e:
        logger.error(f'Slack event error: {e}')
        return HttpResponse(status=200)


@csrf_exempt
def slack_slash_command(request):
    if request.method != 'POST':
        return HttpResponse(status=405)
    user_id = request.POST.get('user_id', '')
    text = request.POST.get('text', '').strip()
    try:
        user = User.objects.get(slack_user_id=user_id)
    except User.DoesNotExist:
        return JsonResponse({'response_type':'ephemeral','text':'⚠️ Your Slack account is not linked to the helpdesk. Log in at the portal first.'})

    if not text:
        url = getattr(settings, 'FRONTEND_URL', 'http://localhost')
        return JsonResponse({'response_type':'ephemeral','text':f'🎫 *Mindstorm IT Helpdesk*\nUsage: `/helpdesk <title> | <description>`\nPortal: {url}'})

    parts = text.split('|', 1)
    title = parts[0].strip()
    description = parts[1].strip() if len(parts) > 1 else title

    if len(title) < 5:
        return JsonResponse({'response_type':'ephemeral','text':'⚠️ Please provide a longer title (at least 5 characters).'})

    ticket = Ticket.objects.create(title=title, description=description, created_by=user, source='slack', category='other', priority='medium')
    TicketHistory.objects.create(ticket=ticket, user=user, action='created', new_value='open')
    apply_sla(ticket)
    apply_auto_assignment(ticket)
    ticket.refresh_from_db()
    notify_ticket_event(ticket, 'created')

    url = f"{getattr(settings,'FRONTEND_URL','http://localhost')}/tickets/{ticket.id}"
    return JsonResponse({'response_type':'ephemeral','text':f'✅ *Ticket created!*\n*<{url}|{ticket.ticket_number}: {ticket.title}>*\nYou\'ll receive updates here.'})


@csrf_exempt
def slack_digest(request):
    if request.method == 'POST':
        from helpdesk.slack_service import send_digest
        send_digest(request.POST.get('period', 'daily'))
    return JsonResponse({'ok': True})
