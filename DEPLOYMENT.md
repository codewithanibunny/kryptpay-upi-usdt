# 🚀 KryptPay Production VPS Hosting & Deployment Guide

This guide details how to deploy the **KryptPay Executive Platform** on any **Ubuntu / Debian VPS** (Hostinger, DigitalOcean, AWS, Hetzner, Vultr, etc.) with custom domain, SSL (HTTPS), Nginx reverse proxy, and PM2 24/7 background manager.

---

## 📋 Prerequisites
1. **Ubuntu / Debian VPS** (Minimum 1GB RAM).
2. **Domain Name** purchased from GoDaddy, Namecheap, Hostinger, Cloudflare, etc.
3. VPS **IP Address** & Root SSH Access (`ssh root@<YOUR_VPS_IP>`).

---

## 🌐 STEP 1: Point Domain DNS A Record to VPS IP
In your Domain Registrar DNS Management (Cloudflare / Namecheap / GoDaddy):
- Add **A Record**: `Type: A`, `Name: @`, `Value: <YOUR_VPS_IP>`, `TTL: Auto`
- Add **A Record**: `Type: A`, `Name: www`, `Value: <YOUR_VPS_IP>`, `TTL: Auto`

---

## 🛠️ STEP 2: One-Click Setup Script on VPS

Connect to your VPS via SSH:
```bash
ssh root@<YOUR_VPS_IP>
```

Run the following command on your VPS terminal:

```bash
# 1. Update system packages
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js v20, Git, Nginx, and Certbot
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx certbot python3-certbot-nginx

# 3. Clone KryptPay repository
sudo mkdir -p /var/www
sudo git clone https://github.com/codewithanibunny/kryptpay-upi-usdt.git /var/www/kryptpay
cd /var/www/kryptpay

# 4. Install Node.js dependencies
npm install

# 5. Install PM2 process manager globally
sudo npm install -g pm2
```

---

## 🔑 STEP 3: Create `.env` Configuration File

Create the `.env` file on your VPS:

```bash
nano /var/www/kryptpay/.env
```

Paste your live production credentials into `.env` (replace `yourdomain.com` with your real domain):

```env
PORT=5000
GOOGLE_CLIENT_ID=459964446959-9se2u9p8mahbili06u56otgvqafcieem.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
FIREBASE_WEB_API_KEY=your_firebase_web_api_key
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
GMAIL_USER=your_gmail@gmail.com
GMAIL_PASS=your_gmail_app_password
MPX_MERCHANT_ID=953045
MPX_API_KEY=c41b55a4b5744069fba2c4744b6b5552cb285971b8f84cb2ad89fe8d959f98a5
MPX_SETTLEMENT_KEY=671AF46538AD9F2407F8E8184C9C695ACEF8D79E32A2D8AAF6924E0843CAA439
MPX_CALLBACK_URL=https://yourdomain.com/api/mpxpay-webhook
```

> 💡 **Firebase Setup Note:** If `FIREBASE_WEB_API_KEY` or `serviceAccountKey.json` is provided, emails (verification & password reset) and user ledgers are handled directly by **Google Firebase Infrastructure** without requiring personal Gmail SMTP!

Press `Ctrl+O` then `Enter` to save, and `Ctrl+X` to exit.

---

## ⚡ STEP 4: Start App with PM2 (24/7 Running)

```bash
cd /var/www/kryptpay
pm2 start server.js --name "kryptpay"
pm2 save
pm2 startup
```

*(This command ensures Node.js restarts automatically if server reboots!)*

---

## 🛡️ STEP 5: Configure Nginx Reverse Proxy

Create Nginx site configuration:

```bash
sudo nano /etc/nginx/sites-available/kryptpay
```

Paste this configuration (replace `yourdomain.com` with your actual domain):

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the Nginx site configuration:

```bash
sudo ln -s /etc/nginx/sites-available/kryptpay /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 🔒 STEP 6: Install Free SSL Certificate (HTTPS)

Run Certbot to secure your domain with HTTPS:

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Select option `2` to redirect HTTP traffic to HTTPS.

---

## 🎉 YOUR PLATFORM IS LIVE!

- **User Website:** `https://yourdomain.com`
- **Admin Control Panel:** `https://yourdomain.com/admin`
  - **Admin ID:** `Aniketwantchai`
  - **Admin Password:** `Aniketwantsex`
- **Webhook Callback URL for MPXPays:** `https://yourdomain.com/api/mpxpay-webhook`

---

## 🔧 Useful Maintenance Commands
- **Check Server Logs:** `pm2 logs kryptpay`
- **Restart Server:** `pm2 restart kryptpay`
- **Stop Server:** `pm2 stop kryptpay`
- **Update Code from GitHub:**
  ```bash
  cd /var/www/kryptpay
  git pull origin master
  pm2 restart kryptpay
  ```
