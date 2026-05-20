# App movil de ordenes de mantenimiento

Version 0.2 del prototipo: ahora tiene backend propio, login por rol, base de datos JSON, notificaciones configurables, reportes imprimibles/PDF y soporte PWA.

## Como ejecutar

Necesitas Node.js 20 o superior.

```bash
npm start
```

Luego abre:

```text
http://localhost:3000
```

## Cuentas demo

- Coordinador: `admin` / `admin123`
- Tecnico: `carlos` / `1234`
- Tecnico: `laura` / `1234`
- Tecnico: `miguel` / `1234`

## Funciones incluidas

- Inicio de sesion por rol.
- Coordinador crea ordenes, asigna tecnicos y gestiona equipo.
- Coordinador edita ordenes para corregir datos, cambiar tecnico asignado o actualizar estado.
- Coordinador crea tecnicos con nombre, usuario, contrasena y WhatsApp; tambien los edita o elimina.
- Las contrasenas se guardan con hash PBKDF2; las cuentas antiguas migran al iniciar sesion.
- Tecnico solo ve sus ordenes asignadas.
- Tecnico inicia, adjunta evidencia y finaliza ordenes.
- Tecnico registra la descripcion de la intervencion antes de finalizar.
- Coordinador puede abrir evidencias en grande y descargarlas.
- Datos persistidos en `db.json`.
- Reporte de orden finalizada con boton "Guardar como PDF".
- PWA instalable desde el navegador.
- Service worker para cargar la interfaz aun sin red local, excepto llamadas API.

## Notificaciones reales

El servidor ya tiene puntos de integracion. Si configuras estas variables de entorno, intentara enviar notificaciones:

```bash
set WHATSAPP_TOKEN=tu_token_de_meta
set WHATSAPP_PHONE_NUMBER_ID=id_numero_whatsapp
set NOTIFICATION_WEBHOOK_URL=https://tu-webhook.com/notificaciones
npm start
```

Para WhatsApp debes llenar el campo `phone` del tecnico en `db.json` usando formato internacional, por ejemplo `573001112233`.

Para correo o push, lo mas practico es conectar `NOTIFICATION_WEBHOOK_URL` con un servicio como Make, Zapier, n8n, SendGrid, Resend, Firebase Cloud Messaging o un backend propio.

## Publicar como Android/iOS con Capacitor

Chrome Android normalmente no ofrece instalacion PWA completa cuando la app se abre por una IP local con `http://`, por ejemplo `http://192.168.x.x:3000`. Para instalarla como PWA necesitas servirla por HTTPS, o publicarla como APK con Capacitor.

Cuando ya tengas Node con acceso a internet, el camino recomendado es:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init OrdenesMantenimiento com.tuempresa.mantenimiento --web-dir .
npx cap add android
npx cap add ios
npx cap sync
```

Para produccion conviene separar el frontend en una carpeta `www` y publicar el backend en un servidor con HTTPS.

## Pendientes antes de produccion

- Cambiar contrasenas demo antes de publicar.
- Mover `db.json` a PostgreSQL, Firebase, Supabase o MongoDB.
- Agregar HTTPS y dominio.
- Configurar proveedores reales de WhatsApp, correo y push.
- Agregar permisos, auditoria y respaldos.
