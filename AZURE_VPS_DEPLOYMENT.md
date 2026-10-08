# 🚀 NexaPay — Azure VPS 24/7 Deployment Guide

This guide details how to deploy **NexaPay** on an Azure Ubuntu VPS with **PM2** (process manager), **Nginx** (reverse proxy), and **Certbot** (free auto-renewing SSL/HTTPS certificate).

---

## 📋 Step 1: Open Inbound Ports in Azure Portal

Before logging into your VPS, ensure HTTP and HTTPS traffic can reach your VM:

1. Open **Azure Portal** (https://portal.azure.com) -> Go to **Virtual Machines** -> Click your VM.
2. Under **Settings** in the left sidebar, click **Networking**.
3. Under **Inbound port rules**, click **Add inbound port rule**:
   - **Service**: `HTTP` | **Port**: `80` | **Action**: `Allow` -> Click **Add**.
   - **Service**: `HTTPS` | **Port**: `443` | **Action**: `Allow` -> Click **Add**.
   - **Service**: `Custom` | **Port**: `5000` | **Action**: `Allow` -> Click **Add**.

---

## 🌐 Step 2: Point Domain to Azure VPS IP in DNSExit / Registrar

1. Copy your Azure VM's **Public IP Address** (e.g. `20.198.xxx.xxx`).
2. Go to your domain manager (DNSExit):
   - **A Record**: Host `@` (or `nexapay.work.gd`) ➔ IP: `<Your-Azure-Public-IP>`
   - **A Record**: Host `www` ➔ IP: `<Your-Azure-Public-IP>`

---

## ⚡ Step 3: Connect to VPS & Run 1-Command Setup

Connect to your Azure VPS via SSH (using PuTTY or Command Prompt):
```bash
ssh azureuser@<YOUR_AZURE_PUBLIC_IP>
```

Run this automated setup script:
```bash
curl -sSL https://raw.githubusercontent.com/codewithanibunny/kryptpay-upi-usdt/main/setup-vps.sh | bash
```

---

## 🛠️ What the Setup Script Does Automatically:
1. Installs Node.js v20, Nginx, PM2, and Certbot (SSL).
2. Clones the latest production code from GitHub.
3. Configures Nginx reverse proxy on Port 80/443 to `http://127.0.0.1:5000`.
4. Starts `server.js` 24/7 with PM2 process manager (auto-restarts on reboot).
5. Secures your custom domain `https://nexapay.work.gd` with free SSL!

---

## 🔍 Useful PM2 Commands:
- Check server status: `pm2 status`
- View live logs: `pm2 logs nexapay`
- Restart server: `pm2 restart nexapay`
