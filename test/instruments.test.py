import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("bi", pathlib.Path(__file__).parent.parent / "scripts" / "build_instruments.py")
bi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bi)

H = "SEM_EXM_EXCH_ID,SEM_SEGMENT,SEM_SMST_SECURITY_ID,SEM_INSTRUMENT_NAME,SEM_TRADING_SYMBOL,SEM_CUSTOM_SYMBOL,SM_SYMBOL_NAME,SEM_SERIES"


def sample():
    rows = [H]
    rows.append("NSE,I,13,INDEX,NIFTY,Nifty 50,NIFTY 50,")
    rows.append("NSE,I,25,INDEX,BANKNIFTY,Nifty Bank,NIFTY BANK,")
    rows.append("BSE,I,51,INDEX,SENSEX,Sensex,SENSEX,")
    for i, n in enumerate(["Nifty IT", "Nifty Auto", "Nifty Pharma", "Nifty FMCG", "Nifty Metal", "Nifty Realty"]):
        rows.append(f"NSE,I,{100+i},INDEX,{n.upper()},{n},{n.upper()},")
    for i in range(60):
        rows.append(f"NSE,E,{1000+i},EQUITY,STK{i},Stock {i},STOCK {i} LTD,EQ")
        rows.append(f"NSE,D,{5000+i},FUTSTK,STK{i}-Nov2026-FUT,STK{i} FUT,STOCK,")
    rows.append("NSE,E,9999,EQUITY,NOFNO,No Fno,NO FNO LTD,EQ")
    return "\n".join(rows)


class T(unittest.TestCase):
    def test_build(self):
        out = bi.build(sample(), 8, 50)
        keys = {i["key"] for i in out["indices"]}
        self.assertTrue({"nifty50", "banknifty", "sensex", "it", "auto"} <= keys)
        self.assertEqual(len(out["fno"]), 60)
        self.assertEqual(out["fno"][0]["id"] // 1000, 1)  # uses NSE_EQ id, not the futures id
        self.assertEqual(len(out["eq"]), 61)

    def test_fails_loudly_when_too_few_indices(self):
        with self.assertRaises(SystemExit):
            bi.build(sample(), 20, 50)


if __name__ == "__main__":
    unittest.main()
