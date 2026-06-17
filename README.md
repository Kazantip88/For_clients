# Trusted Novus Bank — Online Banking App

## Структура проекта

```
tnb-app/
├── backend/
│   ├── server.js          ← Express сервер (порт 4000)
│   ├── db.js              ← In-memory база данных
│   ├── middleware/auth.js ← JWT авторизация
│   └── routes/
│       ├── auth.js        ← /api/auth/login, /api/auth/me
│       ├── accounts.js    ← /api/accounts, /api/accounts/:id/transactions
│       ├── transfers.js   ← /api/transfers
│       └── admin.js       ← /api/admin/clients, /api/admin/credit, /api/admin/debit
└── frontend/
    ├── index.html          ← Главное приложение (все экраны)
    └── register-client.html ← Отдельная страница регистрации клиентов
```

## Запуск бэкенда

```bash
cd backend
cp .env.example .env        # скопируй и заполни переменные
npm install
npm run dev                 # или: node server.js
```

Сервер запустится на: http://localhost:4000

## Запуск фронтенда

Открой `frontend/index.html` в браузере.
Или используй live-server:

```bash
cd frontend
npx serve .
# открой: http://localhost:3000
```

## Тестовые данные

| Поле     | Значение     |
|----------|-------------|
| Username | john.smith  |
| Password | Demo1234!   |
| Роль     | Admin       |

## Функциональность

### Клиентское приложение (index.html)
- ✅ Вход / выход
- ✅ Список счетов (Current, Savings, Crypto)
- ✅ Баланс и история транзакций
- ✅ Отправка денег (Transfer)
- ✅ Получение — реквизиты для приёма
- ✅ Крипто раздел с адресами BTC / ETH / USDT
- ✅ Контакты банка

### Админ-панель (index.html → вкладка Admin)
- ✅ Список всех клиентов
- ✅ Ручное начисление / списание с счёта
- ✅ Кнопка → Register Client

### Регистрация клиентов (register-client.html)
- ✅ Имя, фамилия, email, телефон
- ✅ Username + временный пароль
- ✅ Добавление любого числа счетов (current / savings / crypto)
- ✅ Выбор валюты (GBP, USD, EUR, CHF) для каждого счёта
- ✅ Начальный баланс при открытии счёта
- ✅ Крипто-адреса (редактируемые)
- ✅ Live preview клиента
- ✅ Экран успеха с учётными данными

## API Endpoints

### Auth
POST   /api/auth/login     { username, password }
GET    /api/auth/me

### Accounts
GET    /api/accounts
GET    /api/accounts/:id
GET    /api/accounts/:id/transactions

### Transfers
POST   /api/transfers      { fromAccountId, toIban, toName, amount, reference }
GET    /api/transfers/history

### Admin (требует авторизации admin)
GET    /api/admin/clients
POST   /api/admin/clients  { firstName, lastName, username, password, email, isAdmin, accounts[] }
DELETE /api/admin/clients/:id
POST   /api/admin/credit   { accountId, amount, description }
POST   /api/admin/debit    { accountId, amount, description }

## В продакшене заменить

- [ ] db.js → PostgreSQL или MongoDB
- [ ] JWT_SECRET → сильный рандомный ключ в .env
- [ ] CORS origin → домен фронтенда
- [ ] Добавить HTTPS
- [ ] Добавить 2FA / OTP
- [ ] Email-уведомления при транзакциях
