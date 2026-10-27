export default async function handler(req, res) {
  // Handle CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, lname, email, phone, type, amount, desc } = req.body || {};

  // Validation
  if (!name || name.length < 2 || !email || !type || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
  const TG_CHAT_ID   = process.env.TG_CHAT_ID;

  if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
    return res.status(500).json({ error: 'Server config error' });
  }

  const date = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

  const message =
    `🔔 *Neuer Beratungsfall – Law Legal 500*\n\n` +
    `👤 *Name:* ${name} ${lname || ''}\n` +
    `📧 *Email:* ${email}\n` +
    `📞 *Telefon:* ${phone || '—'}\n` +
    `💼 *Betrugsart:* ${type}\n` +
    `💰 *Betrag:* ${amount}\n` +
    `📅 *Datum:* ${date}\n\n` +
    `📝 *Beschreibung:*\n${desc || '—'}`;

  try {
    const tgRes = await fetch(
      `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TG_CHAT_ID,
          text: message,
          parse_mode: 'Markdown'
        })
      }
    );

    const tgData = await tgRes.json();

    if (!tgData.ok) {
      console.error('TG error:', tgData);
      return res.status(500).json({ error: 'Telegram error' });
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Fetch error:', error);
    return res.status(500).json({ error: 'Network error' });
  }
}
