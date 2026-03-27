from django.urls import path
from . import views

urlpatterns = [
    path('tickets/', views.ticket_list_create),
    path('tickets/admin/stats/', views.admin_stats),
    path('tickets/<int:pk>/', views.ticket_detail),
    path('tickets/<int:pk>/comments/', views.ticket_comment),
    path('tickets/<int:pk>/attachments/', views.ticket_attachment),
    path('tickets/<int:pk>/merge/', views.ticket_merge),
    path('tickets/<int:pk>/link/', views.ticket_link),
    path('users/me/', views.current_user),
    path('users/me/notifications/', views.update_notification_prefs),
    path('users/', views.user_list),
    path('users/<int:pk>/role/', views.update_user_role),
    path('sla-policies/', views.sla_policies),
    path('sla-policies/<int:pk>/', views.sla_policy_detail),
    path('auto-assign-rules/', views.auto_assign_rules),
    path('auto-assign-rules/<int:pk>/', views.auto_assign_rule_detail),
    path('canned-responses/', views.canned_responses),
    path('canned-responses/<int:pk>/', views.canned_response_detail),
    path('notification-logs/', views.notification_logs),
]
