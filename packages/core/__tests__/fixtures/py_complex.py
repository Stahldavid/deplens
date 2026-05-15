import os
import sys
from typing import List, Optional
from collections import defaultdict
def process(items, callback=None):
    result = []
    for item in items:
        if callback:
            result.append(callback(item))
        else:
            result.append(item)
    return result
class Manager:
    def __init__(self, name):
        self.name = name
        self.items = []
    def add_item(self, item):
        self.items.append(item)
    def find(self, predicate):
        for item in self.items:
            if predicate(item):
                return item
        return None
