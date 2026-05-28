// App.js
// Root component — sets up navigation, theme, and decides the start screen
// based on whether a profile already exists on-device.

import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { PaperProvider, MD3LightTheme, ActivityIndicator } from 'react-native-paper';
import { View } from 'react-native';

import OnboardingScreen from './src/screens/OnboardingScreen';
import HomeScreen from './src/screens/HomeScreen';
import FilingScreen from './src/screens/FilingScreen';
import ReceiptScreen from './src/screens/ReceiptScreen';
import SettingsScreen from './src/screens/SettingsScreen';

import { loadProfile } from './src/agents/onboardingAgent';
import { getValidAccessToken } from './src/services/googleDriveService';
import { useStore } from './src/hooks/useStore';

const Stack = createStackNavigator();

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#1a73e8',
    secondary: '#0d7d3f',
  },
};

export default function App() {
  const [loading, setLoading] = useState(true);
  const [initialRoute, setInitialRoute] = useState('Onboarding');
  const setProfile = useStore(s => s.setProfile);
  const setDrive = useStore(s => s.setDrive);

  useEffect(() => {
    (async () => {
      const profile = await loadProfile();
      if (profile) {
        setProfile(profile);
        setInitialRoute('Home');
        // Restore Drive token silently if present
        const token = await getValidAccessToken('').catch(() => null);
        if (token) setDrive(true, token);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <PaperProvider theme={theme}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Filing" component={FilingScreen} />
          <Stack.Screen name="Receipt" component={ReceiptScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false, presentation: 'modal' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </PaperProvider>
  );
}
