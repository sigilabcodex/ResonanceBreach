import './style.css';
import { App } from './app';

const mount = document.querySelector<HTMLDivElement>('#app');

if (!mount) {
  throw new Error('App mount not found.');
}

const app = new App(mount);
app.start();
