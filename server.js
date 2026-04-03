const fs = require('fs');
const path = require('path');
const https = require('https');
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const { Server } = require('socket.io');

const vapidKeys = {
  publicKey: 'BMFhgt2Y6-4o15afxpYypcp2Z7-WyIwPiTElkhzMK8DqwECKXU_NLmFwIf60fVSP8MXJr2zbApjH5KQNSBCq8YI',
  privateKey: 'L-WUoEmk4F_8wOJ-vsqLxe50xLS97HHRjEIXyUGcCJY'
};

webpush.setVapidDetails(
  'mailto:your-email@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

let subscriptions = [];
const reminders = new Map();

function removeDeadSubscriptions(results) {
  subscriptions = subscriptions.filter((subscription, index) => {
    const result = results[index];

    if (result?.status === 'rejected') {
      const statusCode = result.reason?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        return false;
      }
    }

    return true;
  });
}

async function sendPushToAll(payload) {
  if (subscriptions.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    subscriptions.map((subscription) => webpush.sendNotification(subscription, payload))
  );

  removeDeadSubscriptions(results);
}

function scheduleReminder({ id, text, reminderTime }) {
  const delay = reminderTime - Date.now();

  if (delay <= 0) {
    return false;
  }

  const existingReminder = reminders.get(id);
  if (existingReminder) {
    clearTimeout(existingReminder.timeoutId);
  }

  const timeoutId = setTimeout(async () => {
    const payload = JSON.stringify({
      title: '⏰ Напоминание',
      body: text,
      reminderId: id
    });

    await sendPushToAll(payload);
    reminders.delete(id);
  }, delay);

  reminders.set(id, { timeoutId, text, reminderTime });
  return true;
}

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/subscribe', (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ message: 'Некорректная подписка' });
  }

  const exists = subscriptions.some((item) => item.endpoint === subscription.endpoint);
  if (!exists) {
    subscriptions.push(subscription);
  }

  return res.status(201).json({ message: 'Подписка сохранена' });
});

app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  subscriptions = subscriptions.filter((item) => item.endpoint !== endpoint);
  return res.status(200).json({ message: 'Подписка удалена' });
});

app.post('/snooze', (req, res) => {
  const reminderId = Number.parseInt(req.query.reminderId, 10);

  if (!reminderId || !reminders.has(reminderId)) {
    return res.status(404).json({ error: 'Reminder not found' });
  }

  const reminder = reminders.get(reminderId);
  clearTimeout(reminder.timeoutId);

  const newReminderTime = Date.now() + 5 * 60 * 1000;
  scheduleReminder({
    id: reminderId,
    text: reminder.text,
    reminderTime: newReminderTime
  });

  return res.status(200).json({ message: 'Reminder snoozed for 5 minutes' });
});

const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'localhost-key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'localhost.pem'))
};

const server = https.createServer(httpsOptions, app);
const io = new Server(server);

io.on('connection', (socket) => {
  console.log('Клиент подключён:', socket.id);

  socket.on('newTask', async (task) => {
    io.emit('taskAdded', task);

    const payload = JSON.stringify({
      title: 'Новая задача',
      body: task.text
    });

    await sendPushToAll(payload);
  });

  socket.on('newReminder', async (reminder) => {
    const isScheduled = scheduleReminder(reminder);

    if (isScheduled) {
      io.emit('reminderScheduled', reminder);
    }
  });

  socket.on('disconnect', () => {
    console.log('Клиент отключён:', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`HTTPS сервер запущен на https://localhost:${PORT}`);
});
