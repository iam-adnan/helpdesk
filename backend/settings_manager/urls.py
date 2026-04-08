from django.urls import path
from .views import SMTPSettingsView, GeneralSettingsView

urlpatterns = [
    path('smtp/', SMTPSettingsView.as_view()),
    path('general/', GeneralSettingsView.as_view()),
]
