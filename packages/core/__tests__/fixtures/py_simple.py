def add(a, b):
    return a + b
def multiply(x, y):
    return x * y
class Calculator:
    def compute(self, op, a, b):
        if op == 'add':
            return a + b
        elif op == 'mul':
            return a * b
        else:
            return 0
