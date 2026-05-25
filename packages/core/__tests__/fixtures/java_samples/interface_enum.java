package com.example.samples;

public interface MessageBus {
  void publish(String topic, String payload);
}

enum Status {
  READY,
  FAILED;

  public boolean isTerminal() {
    return this == FAILED;
  }
}
