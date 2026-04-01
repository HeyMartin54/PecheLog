import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { colors } from '@/lib/theme';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  focused: boolean;
}) {
  return (
    <View style={[tabIconStyles.wrapper, props.focused && tabIconStyles.wrapperActive]}>
      <Ionicons size={22} {...props} />
    </View>
  );
}

const tabIconStyles = StyleSheet.create({
  wrapper: {
    width: 40,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  wrapperActive: {
    backgroundColor: colors.accentSubtle,
  },
});

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.tabBarBorder,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          marginTop: 2,
        },
        headerStyle: {
          backgroundColor: colors.tabBar,
        },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: '600' },
        headerShown: useClientOnlyValue(false, false),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name="home" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="two"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Carte',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name="map" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Stats',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name="bar-chart" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
