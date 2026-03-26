import { createApp } from './app.js';
import { APP_TITLE } from '../public/js/domain/workspace.js';

const app = createApp();
const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`${APP_TITLE} listening on http://localhost:${port}`);
});
