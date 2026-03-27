from rest_framework import serializers
from .models import (User, Ticket, Comment, TicketHistory, Attachment,
                     TicketLink, SLAPolicy, AutoAssignRule, CannedResponse, NotificationLog)


class UserSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    ticket_count = serializers.SerializerMethodField()
    class Meta:
        model = User
        fields = ['id','email','name','avatar','role','slack_user_id','notify_slack','notify_email','date_joined','last_login_at','ticket_count']
    def get_name(self, obj): return obj.display_name()
    def get_ticket_count(self, obj): return obj.tickets_created.count()


class UserMinimalSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    class Meta:
        model = User
        fields = ['id','email','name','avatar','role']
    def get_name(self, obj): return obj.display_name()


class AttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.SerializerMethodField()
    url = serializers.SerializerMethodField()
    class Meta:
        model = Attachment
        fields = ['id','filename','file_size','mime_type','created_at','uploaded_by_name','url']
    def get_uploaded_by_name(self, obj): return obj.uploaded_by.display_name()
    def get_url(self, obj):
        request = self.context.get('request')
        if obj.file and request:
            return request.build_absolute_uri(obj.file.url)
        return None


class CommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    author_email = serializers.SerializerMethodField()
    author_avatar = serializers.SerializerMethodField()
    author_role = serializers.SerializerMethodField()
    class Meta:
        model = Comment
        fields = ['id','ticket','content','is_internal','source','created_at','author_name','author_email','author_avatar','author_role']
        read_only_fields = ['id','ticket','created_at','source','author_name','author_email','author_avatar','author_role']
    def get_author_name(self, obj): return obj.user.display_name()
    def get_author_email(self, obj): return obj.user.email
    def get_author_avatar(self, obj): return obj.user.avatar
    def get_author_role(self, obj): return obj.user.role


class TicketHistorySerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    class Meta:
        model = TicketHistory
        fields = ['id','action','old_value','new_value','created_at','user_name']
    def get_user_name(self, obj): return obj.user.display_name()


class TicketLinkSerializer(serializers.ModelSerializer):
    linked_number = serializers.SerializerMethodField()
    linked_title = serializers.SerializerMethodField()
    linked_status = serializers.SerializerMethodField()
    class Meta:
        model = TicketLink
        fields = ['id','to_ticket','link_type','linked_number','linked_title','linked_status','created_at']
    def get_linked_number(self, obj): return obj.to_ticket.ticket_number
    def get_linked_title(self, obj): return obj.to_ticket.title
    def get_linked_status(self, obj): return obj.to_ticket.status


class SLAPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = SLAPolicy
        fields = '__all__'


class TicketListSerializer(serializers.ModelSerializer):
    creator_name = serializers.SerializerMethodField()
    creator_email = serializers.SerializerMethodField()
    creator_avatar = serializers.SerializerMethodField()
    assignee_name = serializers.SerializerMethodField()
    sla_response_overdue = serializers.SerializerMethodField()
    sla_resolve_overdue = serializers.SerializerMethodField()
    attachment_count = serializers.SerializerMethodField()
    class Meta:
        model = Ticket
        fields = ['id','ticket_number','title','description','category','priority','status','source',
                  'created_at','updated_at','resolved_at','created_by','assigned_to',
                  'creator_name','creator_email','creator_avatar','assignee_name',
                  'sla_response_due','sla_resolve_due','sla_response_breached','sla_resolve_breached',
                  'sla_response_overdue','sla_resolve_overdue','is_merged','merged_into','attachment_count']
    def get_creator_name(self, obj): return obj.created_by.display_name()
    def get_creator_email(self, obj): return obj.created_by.email
    def get_creator_avatar(self, obj): return obj.created_by.avatar
    def get_assignee_name(self, obj): return obj.assigned_to.display_name() if obj.assigned_to else None
    def get_sla_response_overdue(self, obj): return obj.sla_response_overdue
    def get_sla_resolve_overdue(self, obj): return obj.sla_resolve_overdue
    def get_attachment_count(self, obj): return obj.attachments.count()


class TicketDetailSerializer(TicketListSerializer):
    comments = serializers.SerializerMethodField()
    history = TicketHistorySerializer(many=True, read_only=True)
    attachments = AttachmentSerializer(many=True, read_only=True)
    links = TicketLinkSerializer(many=True, source='links_from', read_only=True)
    class Meta(TicketListSerializer.Meta):
        fields = TicketListSerializer.Meta.fields + ['comments','history','attachments','links']
    def get_comments(self, obj):
        request = self.context.get('request')
        qs = obj.comments.all()
        if request and not request.user.is_admin:
            qs = qs.filter(is_internal=False)
        return CommentSerializer(qs, many=True).data


class AutoAssignRuleSerializer(serializers.ModelSerializer):
    assign_to_name = serializers.SerializerMethodField()
    class Meta:
        model = AutoAssignRule
        fields = ['id','category','assign_to','assign_to_name','is_active']
    def get_assign_to_name(self, obj): return obj.assign_to.display_name() if obj.assign_to else None


class CannedResponseSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    class Meta:
        model = CannedResponse
        fields = ['id','title','content','category','use_count','created_at','created_by_name']
        read_only_fields = ['id','use_count','created_at','created_by_name']
    def get_created_by_name(self, obj): return obj.created_by.display_name()


class NotificationLogSerializer(serializers.ModelSerializer):
    recipient_name = serializers.SerializerMethodField()
    class Meta:
        model = NotificationLog
        fields = ['id','channel','event','status','error','sent_at','recipient_name']
    def get_recipient_name(self, obj): return obj.recipient.display_name()
