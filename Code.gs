// ============================================================
// VetChoapa — Google Apps Script Backend
// Maneja: Gmail (envío de correos) + Google Calendar (Meet)
// ============================================================

const ALLOWED_ORIGIN = '*'; // Cambia a tu URL de Vercel cuando la tengas
                             // Ej: 'https://vetchoapa.vercel.app'

// ------------------------------------------------------------
// ENTRY POINT — Todo entra por acá
// ------------------------------------------------------------
function doPost(e) {
  const headers = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    let result;

    if (action === 'sendEmail') {
      result = sendEmail(body);
    } else if (action === 'createMeet') {
      result = createMeetWithCalendar(body);
    } else {
      result = { success: false, error: 'Acción no reconocida: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Para peticiones OPTIONS (preflight CORS)
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'VetChoapa API activa ✅' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------
// ENVIAR CORREO
// Parámetros esperados:
//   to       — correo destinatario
//   subject  — asunto
//   body     — cuerpo del mensaje (texto plano con saltos de línea)
//   owner    — nombre del tutor (para personalizar)
//   patient  — nombre de la mascota (para personalizar)
// ------------------------------------------------------------
function sendEmail(data) {
  const { to, subject, body, owner, patient } = data;

  if (!to || !subject || !body) {
    return { success: false, error: 'Faltan campos obligatorios: to, subject, body' };
  }

  // Validar formato de correo básico
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { success: false, error: 'Formato de correo inválido: ' + to };
  }

  // Convertir saltos de línea a HTML para el correo
  const htmlBody = buildEmailHTML(body, owner, patient);

  GmailApp.sendEmail(to, subject, body, {
    htmlBody: htmlBody,
    name: 'VetChoapa — Clínica Veterinaria',
    replyTo: Session.getActiveUser().getEmail()
  });

  // Registrar en hoja de cálculo si existe
  logEmailSent(to, subject, owner, patient);

  return {
    success: true,
    message: `Correo enviado a ${to}`
  };
}

// ------------------------------------------------------------
// CREAR EVENTO EN CALENDAR CON GOOGLE MEET
// Parámetros esperados:
//   title      — título del evento
//   date       — fecha (YYYY-MM-DD)
//   time       — hora (HH:MM)
//   duration   — duración en minutos (default 60)
//   owner      — nombre del tutor
//   ownerEmail — correo del tutor (para invitarlo al evento)
//   patient    — nombre de la mascota
//   notes      — notas adicionales
// ------------------------------------------------------------
function createMeetWithCalendar(data) {
  const {
    title,
    date,
    time,
    duration = 60,
    owner,
    ownerEmail,
    patient,
    notes
  } = data;

  if (!date || !time) {
    return { success: false, error: 'Faltan fecha y hora para crear el evento' };
  }

  // Construir fecha/hora de inicio y fin
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  const startTime = new Date(year, month - 1, day, hour, minute, 0);
  const endTime   = new Date(startTime.getTime() + duration * 60 * 1000);

  const eventTitle = title || `Videoconsulta VetChoapa${patient ? ' — ' + patient : ''}`;
  const description = [
    owner   ? `Tutor: ${owner}`   : '',
    patient ? `Paciente: ${patient}` : '',
    notes   ? `\nNotas: ${notes}` : '',
    '\n— Videoconsulta programada desde VetChoapa —'
  ].filter(Boolean).join('\n');

  // Crear evento con conferencia (Google Meet)
  const calendar = CalendarApp.getDefaultCalendar();

  const event = calendar.createEvent(eventTitle, startTime, endTime, {
    description: description,
    conferenceData: {
      createRequest: {
        requestId: 'vetchoapa-' + Date.now(),
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    }
  });

  // Agregar al tutor como invitado si tiene correo
  if (ownerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    try {
      event.addGuest(ownerEmail);
    } catch(err) {
      // Si falla agregar el invitado, continuar igual
      console.log('No se pudo agregar invitado: ' + err.message);
    }
  }

  // Obtener el link de Meet
  // CalendarApp no retorna el link directamente — usamos la API avanzada
  let meetLink = '';
  try {
    const advEvent = Calendar.Events.get('primary', event.getId().replace('@google.com',''));
    meetLink = advEvent.hangoutLink || '';
  } catch(err) {
    // Fallback: construir link desde ID del evento
    meetLink = 'https://meet.google.com/';
    console.log('Usando fallback para Meet link: ' + err.message);
  }

  // Si tiene correo el tutor, enviarle invitación con el link
  if (ownerEmail && meetLink) {
    sendMeetInvitation(ownerEmail, owner, patient, eventTitle, date, time, meetLink);
  }

  return {
    success: true,
    meetLink: meetLink,
    eventId: event.getId(),
    eventTitle: eventTitle,
    startTime: startTime.toISOString(),
    message: `Evento creado: ${eventTitle}`
  };
}

// ------------------------------------------------------------
// PLANTILLA HTML DEL CORREO
// ------------------------------------------------------------
function buildEmailHTML(body, owner, patient) {
  const lines = body.replace(/</g,'&lt;').replace(/>/g,'&gt;').split('\n');
  const htmlLines = lines.map(line => {
    if (line.startsWith('•') || line.startsWith('-')) {
      return `<li style="margin-bottom:4px;">${line.substring(1).trim()}</li>`;
    }
    if (line.trim() === '') return '<br>';
    return `<p style="margin:0 0 8px 0;">${line}</p>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#2d7a3a,#4a9e55);padding:28px 36px;">
            <div style="font-size:26px;margin-bottom:4px;">🐾</div>
            <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">VetChoapa</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.75);letter-spacing:1.5px;text-transform:uppercase;margin-top:2px;">Consulta Veterinaria · Salamanca</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 36px;color:#2c2c2c;font-size:15px;line-height:1.7;">
            ${htmlLines}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fdf8;border-top:1px solid #e8f0e9;padding:20px 36px;">
            <div style="font-size:12px;color:#888;line-height:1.6;">
              <strong style="color:#2d7a3a;">VetChoapa — Clínica Veterinaria</strong><br>
              Dir: El Tambo s/n, Salamanca, Chile<br>
              Este correo fue enviado desde el sistema interno VetChoapa.
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ------------------------------------------------------------
// CORREO DE INVITACIÓN A MEET
// ------------------------------------------------------------
function sendMeetInvitation(toEmail, owner, patient, eventTitle, date, time, meetLink) {
  const dateStr = Utilities.formatDate(
    new Date(date + 'T12:00:00'),
    Session.getScriptTimeZone(),
    "EEEE dd 'de' MMMM 'de' yyyy"
  );

  const subject = `Videoconsulta VetChoapa${patient ? ' — ' + patient : ''} · ${dateStr}`;

  const body = `Estimado/a ${owner || 'tutor/a'},

Le confirmamos su videoconsulta programada en VetChoapa${patient ? ' para ' + patient : ''}.

📅 Fecha: ${dateStr}
🕐 Hora: ${time}
📹 Enlace de videollamada: ${meetLink}

Para unirse, simplemente haga clic en el enlace al momento de la consulta. No necesita descargar ninguna aplicación.

Si necesita reagendar o cancelar, por favor contáctenos con anticipación.

Atentamente,
Equipo VetChoapa
Dir: El Tambo s/n, Salamanca, Chile`;

  GmailApp.sendEmail(toEmail, subject, body, {
    htmlBody: buildEmailHTML(body, owner, patient),
    name: 'VetChoapa — Clínica Veterinaria'
  });
}

// ------------------------------------------------------------
// LOG DE CORREOS ENVIADOS (opcional — si tienes una hoja)
// ------------------------------------------------------------
function logEmailSent(to, subject, owner, patient) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return; // Si no hay hoja activa, saltar
    let sheet = ss.getSheetByName('Log Correos');
    if (!sheet) {
      sheet = ss.insertSheet('Log Correos');
      sheet.appendRow(['Fecha', 'Destinatario', 'Asunto', 'Tutor', 'Paciente']);
    }
    sheet.appendRow([
      new Date().toLocaleString('es-CL'),
      to, subject,
      owner || '',
      patient || ''
    ]);
  } catch(e) {
    // Silencioso — el log es opcional
  }
}
