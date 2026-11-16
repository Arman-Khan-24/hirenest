import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';
export default mergeConfig((base as any)({}), defineConfig({ root: '/Users/ayushant/hirenest', server: { port: 5199, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4010' } } }));
