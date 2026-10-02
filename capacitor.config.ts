import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.otirecovery.app',
  appName: 'OTI Recovery',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'automatic',
    scheme: 'OTI Recovery',
  },
  plugins: {
    // Android 15+ edge-to-edge: let the WebView honor viewport-fit=cover so the CSS
    // env(safe-area-inset-*) padding keeps content clear of the system bars.
    SystemBars: {
      insetsHandling: 'native',
      initialViewportFit: 'cover',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#E0407F',
    },
  },
};

export default config;
