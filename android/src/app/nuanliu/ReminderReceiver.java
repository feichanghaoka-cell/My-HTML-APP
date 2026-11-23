package app.nuanliu;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Locale;

/** 每天到提醒时间由系统闹钟唤起：没记录余额就提醒，并汇总快到扣款日的开销。 */
public class ReminderReceiver extends BroadcastReceiver {
    static final String PREFS = "reminder";
    private static final String ACTION_FIRE = "app.nuanliu.REMIND";
    private static final String CHANNEL = "reminders";

    private static JSONObject data(Context c) {
        try {
            return new JSONObject(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("data", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static PendingIntent alarmIntent(Context c) {
        Intent i = new Intent(c, ReminderReceiver.class).setAction(ACTION_FIRE);
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** 按当前设置安排（或取消）下一次提醒 */
    static void schedule(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent pi = alarmIntent(c);
        am.cancel(pi);
        JSONObject d = data(c);
        if (!d.optBoolean("enabled", false)) return;
        LocalTime at;
        try {
            at = LocalTime.parse(d.optString("time", "21:00"));
        } catch (Exception e) {
            at = LocalTime.of(21, 0);
        }
        LocalDateTime next = LocalDate.now().atTime(at);
        if (!next.isAfter(LocalDateTime.now())) next = next.plusDays(1);
        long when = next.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        if (ACTION_FIRE.equals(intent.getAction())) fire(c);
        schedule(c);
    }

    private static void fire(Context c) {
        JSONObject d = data(c);
        if (!d.optBoolean("enabled", false)) return;
        LocalDate today = LocalDate.now();

        if (!today.toString().equals(d.optString("lastEntry", ""))) {
            notify(c, 1, "该记录今天的余额啦", "花一分钟更新数字，看看今天的现金流。", "#entry");
        }

        int within = d.optInt("remindDays", 3);
        JSONArray bills = d.optJSONArray("bills");
        StringBuilder lines = new StringBuilder();
        int count = 0;
        for (int i = 0; bills != null && i < bills.length(); i++) {
            JSONObject b = bills.optJSONObject(i);
            if (b == null) continue;
            long left;
            try {
                left = ChronoUnit.DAYS.between(today, LocalDate.parse(b.optString("due")));
            } catch (Exception e) {
                continue;
            }
            if (left > within) continue;
            count++;
            if (count > 5) continue;
            String when = left < 0 ? "已过期 " + (-left) + " 天" : left == 0 ? "今天" : left + " 天后";
            if (lines.length() > 0) lines.append('\n');
            lines.append(b.optString("name")).append(" RM ")
                    .append(String.format(Locale.US, "%,.2f", b.optDouble("amount", 0))).append(" · ").append(when);
        }
        if (count > 0) notify(c, 2, count + " 笔开销快到扣款日", lines.toString(), "#bills");
    }

    static void notify(Context c, int id, String title, String text, String hash) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "每日提醒", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = new Intent(c, MainActivity.class)
                .putExtra(MainActivity.EXTRA_HASH, hash)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat)
                .setColor(0xFF5856D6)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        nm.notify(id, n);
    }
}
