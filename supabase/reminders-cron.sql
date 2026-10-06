-- Owner activation only: first enable pg_cron and pg_net in the correct project.
-- Create Vault secrets oti_project_url and oti_reminder_cron_secret in the dashboard.
-- oti_reminder_cron_secret must match the Edge Function secret REMINDER_CRON_SECRET.
-- Deploy event-reminders with JWT verification disabled: the function verifies its own scheduler secret.
select cron.schedule('oti-one-hour-event-reminders','* * * * *',$cron$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='oti_project_url')||'/functions/v1/event-reminders',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='oti_reminder_cron_secret')),
  body:='{}'::jsonb,
  timeout_milliseconds:=60000
 );
$cron$);
