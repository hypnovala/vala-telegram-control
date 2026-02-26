# VPS Deployment Instructions

After merging to main on GitHub:

## 1. SSH into VPS
ssh root@YOUR_SERVER_IP

## 2. Pull latest changes
cd /docker/vala-telegram-bot
git pull origin main

## 3. Restart container
docker compose restart

## 4. Check logs
docker logs -n 20 vala-telegram-bot
