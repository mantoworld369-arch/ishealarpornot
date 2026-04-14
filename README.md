# IsHeAShillOrNot

Crypto Twitter shill detector. Enter a handle → get a report with real DexScreener prices + AI verdict.

## Setup on your DigitalOcean droplet

**1. SSH into your droplet:**
```bash
ssh root@YOUR_IP
```

**2. Install Node (if you don't have it):**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y nodejs
```

**3. Clone and set up:**
```bash
git clone https://github.com/YOUR_USERNAME/ishealarpornot.git
cd ishealarpornot
npm run setup
```

**4. Add your API keys:**
```bash
cp .env.example .env
nano .env
```
Fill in your keys, save with `Ctrl+X → Y → Enter`.

**5. Run it:**
```bash
node server/index.js
```

App is now live at `http://YOUR_IP:3001`

## Keep it running forever

```bash
npm install -g pm2
pm2 start server/index.js --name shill
pm2 save && pm2 startup
```

## Optional: use port 80 (so no :3001 in URL)

Change `PORT=80` in your `.env`, or put nginx in front of it.
