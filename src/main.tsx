if (import.meta.env.DEV) {
  import('./extract').then((m) => ((window as any).ex = m));
}