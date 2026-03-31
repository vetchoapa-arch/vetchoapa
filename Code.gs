// ============================================================
// VetChoapa — Google Apps Script Backend v2
// ============================================================

// ENTRY POINT POST
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    let result;

    if (action === 'sendEmail') {
      result = handleSendEmail(body);
    } else if (action === 'createMeet') {
      result = handleCreateMeet(body);
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

// GET — para verificar que el script está activo
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'VetChoapa API activa ✅' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// ENVIAR CORREO
// ============================================================
function handleSendEmail(data) {
  const { to, subject, body, owner, patient } = data;

  if (!to || !subject || !body) {
    return { success: false, error: 'Faltan campos: to, subject, body' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { success: false, error: 'Correo inválido: ' + to };
  }

  GmailApp.sendEmail(to, subject, body, {
    htmlBody: buildEmailHTML(body, owner, patient),
    name: 'VetChoapa — Clínica Veterinaria',
    replyTo: Session.getActiveUser().getEmail()
  });

  return { success: true, message: 'Correo enviado a ' + to };
}

// ============================================================
// CREAR EVENTO EN CALENDAR + MEET
// ============================================================
function handleCreateMeet(data) {
  const { title, date, time, duration, owner, ownerEmail, patient, notes } = data;

  if (!date || !time) {
    return { success: false, error: 'Faltan fecha u hora' };
  }

  const mins = duration || 60;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute]     = time.split(':').map(Number);
  const startTime = new Date(year, month - 1, day, hour, minute, 0);
  const endTime   = new Date(startTime.getTime() + mins * 60000);

  const eventTitle = title || ('Videoconsulta VetChoapa' + (patient ? ' — ' + patient : ''));
  const description = [
    owner   ? 'Tutor: '    + owner   : '',
    patient ? 'Paciente: ' + patient : '',
    notes   ? 'Notas: '   + notes   : '',
    '',
    '— Videoconsulta programada desde VetChoapa —'
  ].filter(Boolean).join('\n');

  const eventResource = {
    summary: eventTitle,
    description: description,
    start:  { dateTime: startTime.toISOString(), timeZone: Session.getScriptTimeZone() },
    end:    { dateTime: endTime.toISOString(),   timeZone: Session.getScriptTimeZone() },
    conferenceData: {
      createRequest: {
        requestId: 'vet-' + Date.now(),
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    },
    attendees: (ownerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail))
      ? [{ email: ownerEmail }]
      : []
  };

  const createdEvent = Calendar.Events.insert(eventResource, 'primary', { conferenceDataVersion: 1 });

  const meetLink = (createdEvent.conferenceData && createdEvent.conferenceData.entryPoints)
    ? createdEvent.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video').uri
    : '';

  if (ownerEmail && meetLink) {
    sendMeetInvitation(ownerEmail, owner, patient, eventTitle, date, time, meetLink);
  }

  return {
    success:    true,
    meetLink:   meetLink,
    eventId:    createdEvent.id,
    eventTitle: eventTitle,
    message:    'Evento creado con Google Meet'
  };
}

// ============================================================
// PLANTILLA HTML DEL CORREO
// ============================================================
function buildEmailHTML(body, owner, patient) {
  const htmlLines = body
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .split('\n')
    .map(function(line) {
      if (line.startsWith('•') || line.startsWith('-'))
        return '<li style="margin-bottom:4px;">' + line.substring(1).trim() + '</li>';
      if (line.trim() === '') return '<br>';
      return '<p style="margin:0 0 8px 0;">' + line + '</p>';
    }).join('');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0;">' +
    '<tr><td align="center">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;">' +
    '<tr><td style="background:#2d7a3a;padding:28px 36px;">' +
    '<div style="font-size:22px;font-weight:700;color:#fff;">🐾 VetChoapa</div>' +
    '<div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px;">Consulta Veterinaria · Salamanca</div>' +
    '</td></tr>' +
    '<tr><td style="padding:32px 36px;color:#2c2c2c;font-size:15px;line-height:1.7;">' +
    htmlLines + '</td></tr>' +
    '<tr><td style="background:#f8fdf8;border-top:1px solid #e8f0e9;padding:20px 36px;">' +
    '<div style="font-size:12px;color:#888;line-height:1.6;">' +
    '<strong style="color:#2d7a3a;">VetChoapa</strong><br>' +
    'Dir: El Tambo s/n, Salamanca, Chile' +
    '</div></td></tr>' +
    '</table></td></tr></table></body></html>';
}

// ============================================================
// CORREO DE INVITACIÓN A MEET
// ============================================================
function sendMeetInvitation(toEmail, owner, patient, eventTitle, date, time, meetLink) {
  var dateStr = Utilities.formatDate(
    new Date(date + 'T12:00:00'),
    Session.getScriptTimeZone(),
    "EEEE dd 'de' MMMM 'de' yyyy"
  );

  var subject = 'Videoconsulta VetChoapa' + (patient ? ' — ' + patient : '') + ' · ' + dateStr;

  var body =
    'Estimado/a ' + (owner || 'tutor/a') + ',\n\n' +
    'Le confirmamos su videoconsulta en VetChoapa' + (patient ? ' para ' + patient : '') + '.\n\n' +
    '📅 Fecha: ' + dateStr + '\n' +
    '🕐 Hora: ' + time + '\n' +
    '📹 Enlace Meet: ' + meetLink + '\n\n' +
    'Haga clic en el enlace al momento de la consulta.\n\n' +
    'Atentamente,\nEquipo VetChoapa\nDir: El Tambo s/n, Salamanca, Chile';

  GmailApp.sendEmail(toEmail, subject, body, {
    htmlBody: buildEmailHTML(body, owner, patient),
    name: 'VetChoapa — Clínica Veterinaria'
  });
}