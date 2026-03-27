import json
import hashlib
import hmac
import logging
from django.conf import settings
from django.http import JsonResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.urls import path

logger = logging.getLogger(__name__)


def verify_slack_signature(request):
    secret = getattr(settings, 'SLACK_SIGNING_SECRET', '')
    if not secret:
        return True
    ts = request.headers.get('X-Slack-Request-Timestamp', '')
    sig = request.headers.get('X-Slack-Signature', '')
    if not ts or not sig:
        return True  # Skip if headers missing (dev mode)
    base = f'v0:{ts}:{request.body.decode("utf-8", errors="replace")}'
    expected = 'v0=' + hmac.new(secret.encode(), base.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


@csrf_exempt
def slack_events(request):
    """Handles both Event Subscriptions AND Interactivity payloads."""
    if request.method != 'POST':
        return HttpResponse(status=405)

    content_type = request.content_type or ''
    logger.info(f'Slack event received: content_type={content_type}')

    # ── Interactivity payload (form-encoded with 'payload' field) ──
    if 'application/x-www-form-urlencoded' in content_type:
        payload_str = request.POST.get('payload', '')
        if not payload_str:
            logger.warning('No payload in form-encoded request')
            return HttpResponse(status=400)

        try:
            payload = json.loads(payload_str)
        except Exception as e:
            logger.error(f'Failed to parse payload: {e}')
            return HttpResponse(status=400)

        payload_type = payload.get('type', '')
        logger.info(f'Slack interactivity type: {payload_type}')

        if payload_type == 'view_submission':
            callback_id = payload.get('view', {}).get('callback_id', '')
            logger.info(f'Modal submission: callback_id={callback_id}')

            if callback_id == 'raise_ticket':
                try:
                    from helpdesk.slack_service import handle_modal_submission
                    handle_modal_submission(payload)
                    logger.info('Modal submission handled successfully')
                except Exception as e:
                    logger.error(f'Modal submission error: {e}', exc_info=True)
                    # Return error to Slack so user sees it
                    return JsonResponse({
                        'response_action': 'errors',
                        'errors': {
                            'subject_block': str(e)[:100]
                        }
                    })
                # Empty 200 = close modal successfully
                return JsonResponse({})

        return HttpResponse(status=200)

    # ── JSON Event callback ──────────────────────────────────────────
    elif 'application/json' in content_type:
        try:
            data = json.loads(request.body)
        except Exception as e:
            logger.error(f'Failed to parse JSON: {e}')
            return HttpResponse(status=400)

        # URL verification challenge
        if data.get('type') == 'url_verification':
            return JsonResponse({'challenge': data['challenge']})

        # Thread reply → add comment to ticket
        event = data.get('event', {})
        if event.get('type') == 'message' and not event.get('bot_id') and event.get('thread_ts'):
            from helpdesk.slack_service import handle_thread_reply
            handle_thread_reply(event['thread_ts'], event.get('user', ''), event.get('text', ''))

        return HttpResponse(status=200)

    logger.warning(f'Unknown content type: {content_type}')
    return HttpResponse(status=400)


@csrf_exempt
def slack_slash_command(request):
    """Handles /helpdesk slash command — opens modal form."""
    if request.method != 'POST':
        return HttpResponse(status=405)

    user_slack_id = request.POST.get('user_id', '')
    user_email = request.POST.get('user_email', '')
    trigger_id = request.POST.get('trigger_id', '')
    command = request.POST.get('command', '/helpdesk')

    logger.info(f'Slash command: user={user_email} trigger_id={trigger_id[:20] if trigger_id else "NONE"}')

    if not trigger_id:
        return JsonResponse({
            'response_type': 'ephemeral',
            'text': '❌ Missing trigger ID. Please try again.'
        })

    from helpdesk.slack_service import handle_slash_command
    result = handle_slash_command(user_slack_id, user_email, trigger_id)

    if result:
        return JsonResponse(result)
    return HttpResponse(status=200)


@csrf_exempt
def slack_digest(request):
    if request.method == 'POST':
        from helpdesk.slack_service import send_digest
        send_digest(request.POST.get('period', 'daily'))
    return JsonResponse({'ok': True})


urlpatterns = [
    path('events/', slack_events),
    path('command/', slack_slash_command),
    path('digest/', slack_digest),
]
