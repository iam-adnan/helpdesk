from django.db import migrations, models
import django.contrib.auth.models
import django.contrib.auth.validators
import django.db.models.deletion
import django.utils.timezone
import helpdesk.models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('auth', '0012_alter_user_first_name_max_length'),
    ]

    operations = [
        migrations.CreateModel(
            name='User',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('password', models.CharField(max_length=128, verbose_name='password')),
                ('last_login', models.DateTimeField(blank=True, null=True, verbose_name='last login')),
                ('is_superuser', models.BooleanField(default=False)),
                ('username', models.CharField(max_length=150, unique=True, validators=[django.contrib.auth.validators.UnicodeUsernameValidator()])),
                ('first_name', models.CharField(blank=True, max_length=150)),
                ('last_name', models.CharField(blank=True, max_length=150)),
                ('is_staff', models.BooleanField(default=False)),
                ('is_active', models.BooleanField(default=True)),
                ('date_joined', models.DateTimeField(default=django.utils.timezone.now)),
                ('email', models.EmailField(max_length=254, unique=True)),
                ('google_id', models.CharField(blank=True, max_length=128, null=True, unique=True)),
                ('avatar', models.URLField(blank=True, max_length=500, null=True)),
                ('role', models.CharField(choices=[('user', 'User'), ('admin', 'Admin')], default='user', max_length=10)),
                ('slack_user_id', models.CharField(blank=True, max_length=32, null=True, unique=True)),
                ('slack_dm_channel', models.CharField(blank=True, max_length=32, null=True)),
                ('notify_slack', models.BooleanField(default=True)),
                ('notify_email', models.BooleanField(default=False)),
                ('last_login_at', models.DateTimeField(blank=True, null=True)),
                ('groups', models.ManyToManyField(blank=True, related_name='user_set', related_query_name='user', to='auth.group', verbose_name='groups')),
                ('user_permissions', models.ManyToManyField(blank=True, related_name='user_set', related_query_name='user', to='auth.permission', verbose_name='user permissions')),
            ],
            options={'verbose_name': 'user', 'verbose_name_plural': 'users', 'abstract': False},
            managers=[('objects', django.contrib.auth.models.UserManager())],
        ),
        migrations.CreateModel(
            name='SLAPolicy',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=100)),
                ('priority', models.CharField(max_length=10, unique=True)),
                ('response_hours', models.FloatField()),
                ('resolve_hours', models.FloatField()),
                ('is_active', models.BooleanField(default=True)),
            ],
            options={'ordering': ['response_hours']},
        ),
        migrations.CreateModel(
            name='AutoAssignRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('category', models.CharField(max_length=20, unique=True)),
                ('is_active', models.BooleanField(default=True)),
                ('assign_to', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='auto_assignments', to='helpdesk.user')),
            ],
        ),
        migrations.CreateModel(
            name='CannedResponse',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('title', models.CharField(max_length=200)),
                ('content', models.TextField()),
                ('category', models.CharField(blank=True, max_length=20)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('use_count', models.PositiveIntegerField(default=0)),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='helpdesk.user')),
            ],
            options={'ordering': ['-use_count', 'title']},
        ),
        migrations.CreateModel(
            name='Ticket',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('ticket_number', models.CharField(editable=False, max_length=20, unique=True)),
                ('title', models.CharField(max_length=255)),
                ('description', models.TextField()),
                ('category', models.CharField(choices=[('hardware','Hardware'),('software','Software'),('network','Network'),('access','Access / Permissions'),('email','Email'),('other','Other')], default='other', max_length=20)),
                ('priority', models.CharField(choices=[('low','Low'),('medium','Medium'),('high','High'),('critical','Critical')], default='medium', max_length=10)),
                ('status', models.CharField(choices=[('open','Open'),('in_progress','In Progress'),('pending','Pending User'),('resolved','Resolved'),('closed','Closed')], default='open', max_length=15)),
                ('sla_response_due', models.DateTimeField(blank=True, null=True)),
                ('sla_resolve_due', models.DateTimeField(blank=True, null=True)),
                ('sla_response_breached', models.BooleanField(default=False)),
                ('sla_resolve_breached', models.BooleanField(default=False)),
                ('first_response_at', models.DateTimeField(blank=True, null=True)),
                ('slack_channel_ts', models.CharField(blank=True, max_length=64, null=True)),
                ('slack_thread_ts', models.CharField(blank=True, max_length=64, null=True)),
                ('source', models.CharField(choices=[('web','Web'),('slack','Slack')], default='web', max_length=10)),
                ('is_merged', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('resolved_at', models.DateTimeField(blank=True, null=True)),
                ('assigned_to', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='tickets_assigned', to='helpdesk.user')),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='tickets_created', to='helpdesk.user')),
                ('merged_into', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='merged_from', to='helpdesk.ticket')),
                ('sla_policy', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='helpdesk.slapolicy')),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='Attachment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('file', models.FileField(upload_to=helpdesk.models.attachment_path)),
                ('filename', models.CharField(max_length=255)),
                ('file_size', models.PositiveIntegerField(default=0)),
                ('mime_type', models.CharField(blank=True, max_length=100)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('ticket', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='attachments', to='helpdesk.ticket')),
                ('uploaded_by', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='helpdesk.user')),
            ],
        ),
        migrations.CreateModel(
            name='Comment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('content', models.TextField()),
                ('is_internal', models.BooleanField(default=False)),
                ('slack_ts', models.CharField(blank=True, max_length=64, null=True)),
                ('source', models.CharField(choices=[('web','Web'),('slack','Slack')], default='web', max_length=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('ticket', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comments', to='helpdesk.ticket')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comments', to='helpdesk.user')),
            ],
            options={'ordering': ['created_at']},
        ),
        migrations.CreateModel(
            name='TicketHistory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('action', models.CharField(max_length=50)),
                ('old_value', models.CharField(blank=True, max_length=255, null=True)),
                ('new_value', models.CharField(blank=True, max_length=255, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('ticket', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='history', to='helpdesk.ticket')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='helpdesk.user')),
            ],
            options={'ordering': ['created_at']},
        ),
        migrations.CreateModel(
            name='TicketLink',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('link_type', models.CharField(choices=[('related','Related to'),('duplicate','Duplicate of'),('blocks','Blocks'),('blocked_by','Blocked by')], default='related', max_length=20)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='helpdesk.user')),
                ('from_ticket', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='links_from', to='helpdesk.ticket')),
                ('to_ticket', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='links_to', to='helpdesk.ticket')),
            ],
            options={'unique_together': {('from_ticket', 'to_ticket', 'link_type')}},
        ),
        migrations.CreateModel(
            name='NotificationLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('channel', models.CharField(choices=[('slack','Slack'),('email','Email')], max_length=10)),
                ('event', models.CharField(max_length=50)),
                ('status', models.CharField(choices=[('sent','Sent'),('failed','Failed'),('skipped','Skipped')], default='sent', max_length=10)),
                ('error', models.TextField(blank=True)),
                ('sent_at', models.DateTimeField(auto_now_add=True)),
                ('recipient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='helpdesk.user')),
                ('ticket', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to='helpdesk.ticket')),
            ],
            options={'ordering': ['-sent_at']},
        ),
    ]
