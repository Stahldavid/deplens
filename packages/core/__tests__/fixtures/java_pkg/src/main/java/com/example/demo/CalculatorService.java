package com.example.demo;

import java.util.List;

public class CalculatorService extends BaseService implements Runnable, AutoCloseable {
  private final List<String> values;

  public CalculatorService(List<String> values) {
    this.values = values;
  }

  public int add(int left, int right) {
    if (left > right && right > 0) {
      return left + right;
    }

    return left + right;
  }

  @Override
  public void run() {
    for (String value : values) {
      System.out.println(value);
    }
  }

  @Override
  public void close() {}
}
