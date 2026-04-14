import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function ChatBubble({ sender, text }) {
  const isUser = sender === "user";
  return (
    <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    padding: 10,
    marginVertical: 5,
    borderRadius: 10,
    maxWidth: "80%",
  },
  userBubble: {
    backgroundColor: "#007AFF",
    alignSelf: "flex-end",
  },
  aiBubble: {
    backgroundColor: "#EAEAEA",
    alignSelf: "flex-start",
  },
  text: {
    color: "#000",
  },
});
