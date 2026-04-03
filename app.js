const contentDiv = document.getElementById('app-content');
const homeBtn = document.getElementById('home-btn');
const aboutBtn = document.getElementById('about-btn');
const enablePushBtn = document.getElementById('enable-push');
const disablePushBtn = document.getElementById('disable-push');

const socket = io();

function setActiveButton(activeId) {
  [homeBtn, aboutBtn].forEach((btn) => btn.classList.remove('active'));
  document.getElementById(activeId)?.classList.add('active');
}

async function loadContent(page) {
  try {
    const response = await fetch(`content/${page}.html`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    contentDiv.innerHTML = html;

    if (page === 'home') {
      initNotes();
    }
  } catch (err) {
    contentDiv.innerHTML = '<p class="is-center text-error">Ошибка загрузки страницы.</p>';
    console.error('Ошибка загрузки контента:', err);
  }
}

homeBtn.addEventListener('click', () => {
  setActiveButton('home-btn');
  loadContent('home');
});

aboutBtn.addEventListener('click', () => {
  setActiveButton('about-btn');
  loadContent('about');
});

function showToast(message) {
  const notification = document.createElement('div');

  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: #4285f4;
    color: white;
    padding: 1rem;
    border-radius: 6px;
    z-index: 1000;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

function normalizeNotes(notes) {
  return notes.map((note) => {
    if (typeof note === 'string') {
      return {
        id: Date.now() + Math.random(),
        text: note,
        createdAt: Date.now(),
        reminder: null
      };
    }

    return {
      id: note.id ?? Date.now() + Math.random(),
      text: note.text ?? '',
      createdAt: note.createdAt ?? Date.now(),
      reminder: note.reminder ?? null
    };
  });
}

function getNotes() {
  const notes = JSON.parse(localStorage.getItem('notes') || '[]');
  const normalized = normalizeNotes(notes);

  if (JSON.stringify(notes) !== JSON.stringify(normalized)) {
    localStorage.setItem('notes', JSON.stringify(normalized));
  }

  return normalized;
}

function saveNotes(notes) {
  localStorage.setItem('notes', JSON.stringify(notes));
}

function formatReminder(reminder) {
  if (!reminder) return '';

  const date = new Date(reminder);
  return `<br><small>⏰ Напоминание: ${date.toLocaleString('ru-RU')}</small>`;
}

function renderNotesList() {
  const list = document.getElementById('notes-list');
  if (!list) return;

  const notes = getNotes();

  if (notes.length === 0) {
    list.innerHTML = '<li class="card" style="padding: 0.75rem;">Пока заметок нет</li>';
    return;
  }

  list.innerHTML = notes
    .map((note) => `
      <li class="card" style="margin-bottom: 0.5rem; padding: 0.75rem;">
        <strong>${note.text}</strong>${formatReminder(note.reminder)}
      </li>
    `)
    .join('');
}

function addNote(text, reminderTimestamp = null) {
  const notes = getNotes();

  const newNote = {
    id: Date.now(),
    text,
    createdAt: Date.now(),
    reminder: reminderTimestamp
  };

  notes.push(newNote);
  saveNotes(notes);
  renderNotesList();

  if (reminderTimestamp) {
    socket.emit('newReminder', {
      id: newNote.id,
      text: newNote.text,
      reminderTime: reminderTimestamp
    });
  } else {
    socket.emit('newTask', {
      id: newNote.id,
      text: newNote.text,
      timestamp: Date.now()
    });
  }
}

function initNotes() {
  const form = document.getElementById('note-form');
  const input = document.getElementById('note-input');
  const reminderForm = document.getElementById('reminder-form');
  const reminderText = document.getElementById('reminder-text');
  const reminderTime = document.getElementById('reminder-time');

  if (!form || !input || !reminderForm || !reminderText || !reminderTime) {
    return;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const text = input.value.trim();
    if (!text) return;

    addNote(text);
    input.value = '';
    input.focus();
  });

  reminderForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const text = reminderText.value.trim();
    const datetime = reminderTime.value;

    if (!text || !datetime) {
      return;
    }

    const timestamp = new Date(datetime).getTime();

    if (Number.isNaN(timestamp) || timestamp <= Date.now()) {
      alert('Дата напоминания должна быть в будущем.');
      return;
    }

    addNote(text, timestamp);
    reminderText.value = '';
    reminderTime.value = '';
  });

  renderNotesList();
}

window.addEventListener('storage', () => {
  renderNotesList();
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

async function getVapidPublicKey() {
  const response = await fetch('/api/vapid-public-key');
  if (!response.ok) {
    throw new Error('Не удалось получить публичный VAPID-ключ');
  }

  const data = await response.json();
  return data.publicKey;
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push-уведомления не поддерживаются браузером');
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    const publicKey = await getVapidPublicKey();

    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  await fetch('/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription)
  });

  return subscription;
}

async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    await fetch('/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });

    await subscription.unsubscribe();
  }
}

function updatePushButtons(isSubscribed) {
  if (!enablePushBtn || !disablePushBtn) return;

  enablePushBtn.style.display = isSubscribed ? 'none' : 'inline-block';
  disablePushBtn.style.display = isSubscribed ? 'inline-block' : 'none';
}

socket.on('connect', () => {
  console.log('Socket connected:', socket.id);
});

socket.on('connect_error', (err) => {
  console.error('Socket connect error:', err);
});

socket.on('taskAdded', (task) => {
  console.log('Задача от сервера:', task);
  showToast(`Новая задача: ${task.text}`);
});

socket.on('reminderScheduled', (reminder) => {
  console.log('Напоминание запланировано:', reminder);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('SW registered:', registration.scope);

      if ('PushManager' in window) {
        const currentSubscription = await registration.pushManager.getSubscription();
        updatePushButtons(Boolean(currentSubscription));
      }

      enablePushBtn?.addEventListener('click', async () => {
        try {
          let permission = Notification.permission;

          if (permission === 'default') {
            permission = await Notification.requestPermission();
          }

          if (permission !== 'granted') {
            alert('Необходимо разрешить уведомления в браузере.');
            return;
          }

          await subscribeToPush();
          updatePushButtons(true);
          alert('Push-уведомления включены.');
        } catch (err) {
          console.error('Ошибка подписки на push:', err);
          alert('Не удалось включить push-уведомления.');
        }
      });

      disablePushBtn?.addEventListener('click', async () => {
        try {
          await unsubscribeFromPush();
          updatePushButtons(false);
          alert('Push-уведомления отключены.');
        } catch (err) {
          console.error('Ошибка отписки от push:', err);
          alert('Не удалось отключить push-уведомления.');
        }
      });
    } catch (err) {
      console.error('SW registration failed:', err);
    }
  });
}

loadContent('home');
