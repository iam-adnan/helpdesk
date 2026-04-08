from django.urls import path
from .views import SlackSettingsView, AISettingsView

urlpatterns = [
    path('slack/', SlackSettingsView.as_view()),
    path('ai/', AISettingsView.as_view()),
]
