/** Purpose: checks the mail settings by sending one test email: `npm run mail:test -- you@example.com` (add --prod for production). */
import { config } from '../src/config/index.js';
import { createMailer } from '../src/services/mail.service.js';

const to = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!to) {
  console.error('Usage: npm run mail:test -- you@example.com');
  process.exit(1);
}

const mailer = createMailer(config);
const error = await mailer.verify();
if (error) {
  console.error(`Mail is not ready: ${error}`);
  process.exit(1);
}

const sent = await mailer.send({ to, subject: 'Invenza test email', text: 'Your Invenza mail settings work.' });
console.log(sent ? `Test email handed to the mail server for ${to}.` : 'The test email could not be sent.');
process.exit(sent ? 0 : 1);
