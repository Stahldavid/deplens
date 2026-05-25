package com.example.samples;

import java.util.List;

public class Service {
  private final List<String> values;

  public Service(List<String> values) {
    this.values = values;
  }

  public int calculate(int left, int right) {
    if (left > right && right > 0) {
      return left + right;
    }

    return left + right;
  }
}
