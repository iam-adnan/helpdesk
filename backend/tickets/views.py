from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from accounts.models import User
from .models import Ticket, TicketComment, TicketActivity
from .serializers import (
    TicketListSerializer, TicketDetailSerializer, TicketCreateSerializer,
    TicketUpdateSerializer, TicketCommentSerializer
)
import logging

logger = logging.getLogger('helpdesk')


class TicketViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    filterset_fields = ['status', 'priority', 'category', 'support_team', 'assigned_to']
    search_fields = ['subject', 'ticket_number', 'description']
    ordering_fields = ['created_at', 'updated_at', 'priority', 'status']

    def get_queryset(self):
        user = self.request.user
        # Admin and agent see ALL tickets
        if user.is_staff or user.is_superuser or user.role in ('admin', 'agent'):
            return Ticket.objects.all()
        # Regular users see only their own
        return Ticket.objects.filter(created_by=user)

    def get_serializer_class(self):
        if self.action == 'create':
            return TicketCreateSerializer
        if self.action in ('update', 'partial_update'):
            return TicketUpdateSerializer
        if self.action == 'retrieve':
            return TicketDetailSerializer
        return TicketListSerializer

    def perform_create(self, serializer):
        ticket = serializer.save(created_by=self.request.user)
        TicketActivity.objects.create(
            ticket=ticket, user=self.request.user,
            action='created', new_value=ticket.ticket_number
        )

    def perform_update(self, serializer):
        old_status = self.get_object().status
        old_priority = self.get_object().priority
        ticket = serializer.save()
        if old_status != ticket.status:
            TicketActivity.objects.create(
                ticket=ticket, user=self.request.user,
                action='status_changed', old_value=old_status, new_value=ticket.status
            )
        if old_priority != ticket.priority:
            TicketActivity.objects.create(
                ticket=ticket, user=self.request.user,
                action='priority_changed', old_value=old_priority, new_value=ticket.priority
            )
        if ticket.status == 'resolved' and not ticket.resolved_at:
            ticket.resolved_at = timezone.now()
            ticket.save(update_fields=['resolved_at'])
        if ticket.status == 'closed' and not ticket.closed_at:
            ticket.closed_at = timezone.now()
            ticket.save(update_fields=['closed_at'])

    @action(detail=True, methods=['post'])
    def comment(self, request, pk=None):
        ticket = self.get_object()
        content = request.data.get('content', '')
        comment_type = request.data.get('comment_type', 'public')
        if not content:
            return Response({'error': 'Content required.'}, status=400)
        comment = TicketComment.objects.create(
            ticket=ticket, author=request.user,
            content=content, comment_type=comment_type
        )
        return Response(TicketCommentSerializer(comment).data, status=201)

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        ticket = self.get_object()
        agent_id = request.data.get('agent_id')
        try:
            agent = User.objects.get(id=agent_id)
            old = str(ticket.assigned_to) if ticket.assigned_to else 'Unassigned'
            ticket.assigned_to = agent
            if ticket.status == 'open':
                ticket.status = 'in_progress'
            ticket.save()
            TicketActivity.objects.create(
                ticket=ticket, user=request.user,
                action='assigned', old_value=old, new_value=str(agent)
            )
            return Response(TicketDetailSerializer(ticket).data)
        except User.DoesNotExist:
            return Response({'error': 'Agent not found.'}, status=404)

    @action(detail=False, methods=['get'])
    def stats(self, request):
        qs = self.get_queryset()
        return Response({
            'total': qs.count(),
            'open': qs.filter(status='open').count(),
            'in_progress': qs.filter(status='in_progress').count(),
            'resolved': qs.filter(status='resolved').count(),
            'closed': qs.filter(status='closed').count(),
            'urgent': qs.filter(priority='urgent', status__in=['open', 'in_progress']).count(),
        })
