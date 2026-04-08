from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User

@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ('email','username','role','is_active','created_at')
    list_filter = ('role','is_active')
    search_fields = ('email','username','first_name','last_name')
    ordering = ('-created_at',)
    fieldsets = BaseUserAdmin.fieldsets + (
        ('Extra', {'fields': ('role','department','phone','slack_user_id','avatar')}),
    )
