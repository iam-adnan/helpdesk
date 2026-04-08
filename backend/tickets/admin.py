from django.contrib import admin
from .models import Ticket, TicketComment, TicketActivity, TicketAttachment

@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ('ticket_number','subject','status','priority','created_by','assigned_to','created_at')
    list_filter = ('status','priority','category','support_team')
    search_fields = ('ticket_number','subject','description')

admin.site.register(TicketComment)
admin.site.register(TicketActivity)
admin.site.register(TicketAttachment)
