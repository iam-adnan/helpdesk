from django.urls import path
from .slack_views import slack_command, slack_interaction

urlpatterns = [
    path('commands/', slack_command),
    path('interactions/', slack_interaction),
]
