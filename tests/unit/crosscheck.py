# Independent calculation of the same bills with Python's Decimal (rupees, not paise).
import json
import sys
from decimal import Decimal as D, ROUND_HALF_UP

PAISA = D("0.01")
RUPEE = D("1")


def paise(x):
    return int((x * 100).to_integral_value())


def group_indian(n):
    s = str(n)
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts) + "," + tail


out = []
for bill in json.load(open(sys.argv[1])):
    total = D(0)
    nets = []
    for line in bill["lines"]:
        rate = D(line["rate"]) / 100
        percent = D(line["disc"]) / 100
        gross = rate * line["qty"]
        net = (gross * (D(100) - percent) / D(100)).quantize(PAISA, rounding=ROUND_HALF_UP)
        nets.append(paise(net))
        total += net
    gst = (total * D(bill["gst"]) / D(10000)).quantize(PAISA, rounding=ROUND_HALF_UP)
    with_gst = (total + gst).quantize(RUPEE, rounding=ROUND_HALF_UP)
    without = total.quantize(RUPEE, rounding=ROUND_HALF_UP)
    whole, frac = divmod(paise(total), 100)
    out.append({"nets": nets, "total": paise(total), "gst": paise(gst), "withGst": paise(with_gst), "withoutGst": paise(without), "totalText": f"{group_indian(whole)}.{frac:02d}"})
json.dump(out, sys.stdout)
