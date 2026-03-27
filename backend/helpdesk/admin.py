from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, Ticket, Comment, TicketHistory, SLAPolicy, AutoAssignRule, CannedResponse, NotificationLog

@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ['email', 'display_name', 'role', 'date_joined']
    list_filter = ['role', 'is_active']
    search_fields = ['email', 'first_name', 'last_name']
    ordering = ['-date_joined']
    fieldsets = BaseUserAdmin.fieldsets + (('Mindstorm', {'fields': ('role', 'avatar', 'google_id', 'slack_user_id', 'notify_slack', 'notify_email')}),)

@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ['ticket_number', 'title', 'status', 'priority', 'created_by', 'assigned_to', 'created_at']
    list_filter = ['status', 'priority', 'category', 'source']
    search_fields = ['ticket_number', 'title', 'description']
    raw_id_fields = ['created_by', 'assigned_to']

@admin.register(SLAPolicy)
class SLAPolicyAdmin(admin.ModelAdmin):
    list_display = ['name', 'priority', 'response_hours', 'resolve_hours', 'is_active']

@admin.register(AutoAssignRule)
class AutoAssignRuleAdmin(admin.ModelAdmin):
    list_display = ['category', 'assign_to', 'is_active']

admin.site.register(Comment)
admin.site.register(TicketHistory)
admin.site.register(CannedResponse)
admin.site.register(NotificationLog)
