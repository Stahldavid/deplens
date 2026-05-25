package com.example.demo;

public interface MessageBus extends AutoCloseable {
  void publish(String topic, String payload);
}

enum Status {
  READY,
  FAILED;

  public boolean isTerminal() {
    return this == FAILED;
  }
}
