import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";

import ProfileScreen from "./screens/ProfileScreen";
import HomeScreen from "./screens/HomeScreen";
import ChatbotScreen from "./screens/ChatbotScreen";
import PlanScreen from "./screens/PlanScreen";
import ProgressScreen from "./screens/ProgressScreen";

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Profile"
        screenOptions={{
          headerStyle: { backgroundColor: "#0B6E4F" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "bold" },
        }}
      >
        <Stack.Screen
          name="Profile"
          component={ProfileScreen}
          options={{ headerShown: false }}
        />

        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: "AI Fitness Coach 🏋️‍♂️" }}
        />

        <Stack.Screen
          name="Chatbot"
          component={ChatbotScreen}
          options={{ title: "AI Chatbot 🤖" }}
        />

        <Stack.Screen
          name="Plan"
          component={PlanScreen}
          options={{ title: "Your Daily Fitness Plan 💪" }}
        />

        <Stack.Screen
        name="Progress"
        component={ProgressScreen}
        options={{ title: "Your Daily Fitness Progress" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
