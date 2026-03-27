from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse
from django.views.generic import TemplateView


def health_check(request):
    return JsonResponse({'status': 'ok'})


urlpatterns = [
    path('health/', health_check),
    path('django-admin/', admin.site.urls),
    # Auth routes available at BOTH /auth/ and /api/auth/ so frontend api instance works
    path('auth/', include('helpdesk.auth_urls')),
    path('api/auth/', include('helpdesk.auth_urls')),
    path('api/', include('helpdesk.urls')),
    path('slack/', include('helpdesk.slack_urls')),
]

urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

urlpatterns += [
    re_path(
        r'^(?!api|auth|django-admin|django-static|health|slack|media).*$',
        TemplateView.as_view(template_name='index.html'),
        name='react-app'
    ),
]
