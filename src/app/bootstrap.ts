import '../style.css';
import { App } from './game';

export const bootstrap = (): App => {
  const mount = document.querySelector<HTMLDivElement>('#app');

  if (!mount) {
    throw new Error('App mount not found.');
  }

  const app = new App(mount);
  app.start();
  return app;
};
