if (import.meta.env.DEV) {
  import('./db/smoke').then((m) => {
    (window as any).runDbSmokeTest = m.runDbSmokeTest;
  });
}