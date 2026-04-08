from rest_framework import serializers
from accounts.serializers import UserSerializer
from .models import Ticket, TicketComment, TicketAttachment, TicketActivity

class TicketAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketAttachment
        fields = ['id','file','filename','file_size','uploaded_by','created_at']
        read_only_fields = ['id','uploaded_by','created_at','file_size']

class TicketCommentSerializer(serializers.ModelSerializer):
    author = UserSerializer(read_only=True)
    attachments = TicketAttachmentSerializer(many=True, read_only=True)
    class Meta:
        model = TicketComment
        fields = ['id','ticket','author','content','comment_type','attachments','created_at','updated_at']
        read_only_fields = ['id','author','created_at','updated_at']

class TicketActivitySerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    class Meta:
        model = TicketActivity
        fields = ['id','user','action','old_value','new_value','created_at']

class TicketListSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    assigned_to = UserSerializer(read_only=True)
    comment_count = serializers.SerializerMethodField()
    class Meta:
        model = Ticket
        fields = ['id','ticket_number','subject','status','priority','category','support_team','created_by','assigned_to','tags','created_at','updated_at','comment_count']
    def get_comment_count(self, obj):
        return obj.comments.filter(comment_type='public').count()

class TicketDetailSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    assigned_to = UserSerializer(read_only=True)
    comments = TicketCommentSerializer(many=True, read_only=True)
    activities = TicketActivitySerializer(many=True, read_only=True)
    attachments = TicketAttachmentSerializer(many=True, read_only=True)
    class Meta:
        model = Ticket
        fields = ['id','ticket_number','subject','description','status','priority','category','support_team','created_by','assigned_to','tags','slack_channel_id','slack_message_ts','first_response_at','resolved_at','closed_at','created_at','updated_at','comments','activities','attachments']

class TicketCreateSerializer(serializers.ModelSerializer):
    requester_email = serializers.EmailField(required=False, write_only=True)
    class Meta:
        model = Ticket
        fields = ['subject','description','priority','category','support_team','tags','requester_email']

class TicketUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Ticket
        fields = ['subject','description','status','priority','category','support_team','assigned_to','tags']
