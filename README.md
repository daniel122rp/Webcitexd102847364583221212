# MTA Store Pro

Store full-stack para vender productos de MTA con:

- login con Discord
- catálogo en portada con filtros
- carrito de compras
- checkout con PayPal Orders API
- entrega automática al capturar el pago
- panel privado del cliente
- licencias con key e IP del servidor
- endpoint de validación para scripts MTA
- panel admin para subir productos, imágenes y ZIP/LUA

## Requisitos

- Node 20 recomendado

## Arranque local

```bash
copy .env.example .env
npm install
npm run dev
```

Abre `http://localhost:3000`

## Discord OAuth

Configura en `.env`:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
- `DISCORD_ADMIN_IDS`

## PayPal

Configura en `.env`:

- `PAYPAL_MODE=sandbox` o `live`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID` (opcional, recomendado para producción)

El flujo local puede capturar el pago al volver desde PayPal a `return_url`.
Para webhooks automáticos en producción, usa una URL HTTPS pública.

## Validación de key desde MTA

Tu script puede consultar:

`GET /api/license/validate?key=TU_KEY&ip=123.45.67.89&product=slug-del-producto`

Respuesta ejemplo:

```json
{ "valid": true, "reason": "ok", "product": { "slug": "neo-login-panel", "name": "Neo Login Panel" } }
```


## Deploy gratis recomendado (Railway)

Esta app guarda datos y archivos subidos. Para no perderlos en Railway, monta un volumen y define:

```env
STORAGE_DIR=/data
```

Luego en Railway:

- monta un volumen en `/data`
- usa `npm start`
- configura healthcheck en `/health`
- define `BASE_URL` con tu dominio público de Railway

No subas `.env` ni `node_modules` a GitHub.
