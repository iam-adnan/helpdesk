from rest_framework.views import APIView
from rest_framework.response import Response
from accounts.permissions import IsAdmin, IsAgentOrAdmin
from tickets.models import Ticket, TicketActivity
from accounts.models import User
from django.utils import timezone
from django.db.models import Count, Avg, F, Q
from datetime import timedelta

class DashboardStatsView(APIView):
    permission_classes = [IsAgentOrAdmin]

    def get(self, request):
        now = timezone.now()
        days = int(request.query_params.get('days', 30))
        since = now - timedelta(days=days)
        tickets = Ticket.objects.filter(created_at__gte=since)

        # Status breakdown
        status_counts = dict(tickets.values_list('status').annotate(c=Count('id')).values_list('status','c'))

        # Priority breakdown
        priority_counts = dict(tickets.values_list('priority').annotate(c=Count('id')).values_list('priority','c'))

        # Category breakdown
        category_counts = dict(tickets.values_list('category').annotate(c=Count('id')).values_list('category','c'))

        # Daily ticket creation (last N days)
        from django.db.models.functions import TruncDate
        daily = list(
            tickets.annotate(date=TruncDate('created_at'))
            .values('date').annotate(count=Count('id'))
            .order_by('date').values('date','count')
        )

        # Agent performance
        agents = list(
            Ticket.objects.filter(assigned_to__isnull=False, created_at__gte=since)
            .values('assigned_to__email','assigned_to__first_name','assigned_to__last_name')
            .annotate(
                total=Count('id'),
                resolved=Count('id', filter=Q(status__in=['resolved','closed'])),
            )
            .order_by('-total')[:10]
        )

        # Avg resolution time
        resolved = tickets.filter(resolved_at__isnull=False)
        avg_hours = None
        if resolved.exists():
            from django.db.models import ExpressionWrapper, DurationField
            durations = resolved.annotate(
                duration=ExpressionWrapper(F('resolved_at') - F('created_at'), output_field=DurationField())
            )
            total_secs = sum(d.duration.total_seconds() for d in durations)
            avg_hours = round(total_secs / resolved.count() / 3600, 1)

        # SLA: First response time
        responded = tickets.filter(first_response_at__isnull=False)
        avg_first_response_mins = None
        if responded.exists():
            from django.db.models import ExpressionWrapper, DurationField
            durations = responded.annotate(
                duration=ExpressionWrapper(F('first_response_at') - F('created_at'), output_field=DurationField())
            )
            total_secs = sum(d.duration.total_seconds() for d in durations)
            avg_first_response_mins = round(total_secs / responded.count() / 60, 1)

        return Response({
            'period_days': days,
            'total_tickets': tickets.count(),
            'status_breakdown': status_counts,
            'priority_breakdown': priority_counts,
            'category_breakdown': category_counts,
            'daily_tickets': [{'date': str(d['date']), 'count': d['count']} for d in daily],
            'agent_performance': agents,
            'avg_resolution_hours': avg_hours,
            'avg_first_response_mins': avg_first_response_mins,
            'total_users': User.objects.filter(is_active=True).count(),
        })
