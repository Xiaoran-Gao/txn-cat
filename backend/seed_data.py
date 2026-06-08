from database import db_connection

DEFAULT_CATEGORIES = [
    ("餐饮美食", [
        "餐馆", "快餐", "外卖", "咖啡饮品", "零食",
    ]),
    ("交通出行", [
        "公共交通", "加油充电", "打车代驾", "停车费", "汽车维修",
    ]),
    ("购物消费", [
        "服饰鞋包", "数码电器", "家居日用", "网购", "商超百货",
    ]),
    ("休闲娱乐", [
        "视频会员", "电影演出", "游戏", "运动健身", "图书",
    ]),
    ("住房居家", [
        "房租房贷", "水电燃气", "物业费", "通讯宽带", "维修",
    ]),
    ("医疗健康", [
        "药店", "医院诊所", "体检", "保险",
    ]),
    ("金融理财", [
        "银行手续费", "利息收支", "投资理财", "信用卡还款",
    ]),
    ("旅行出行", [
        "机票", "酒店", "火车票", "景点游玩",
    ]),
    ("教育学习", [
        "培训", "资料", "学费",
    ]),
    ("收入", [
        "工资", "兼职", "退款", "理财收益",
    ]),
    ("其他", [
        "其他",
    ]),
]

def seed_default_data():
    with db_connection() as conn:
        cur = conn.execute("SELECT COUNT(*) FROM categories")
        if cur.fetchone()[0] == 0:
            for cat_name, subs in DEFAULT_CATEGORIES:
                conn.execute(
                    "INSERT INTO categories (name, parent_id) VALUES (?, NULL)",
                    (cat_name,)
                )
                parent_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                for sub_name in subs:
                    conn.execute(
                        "INSERT INTO categories (name, parent_id) VALUES (?, ?)",
                        (sub_name, parent_id)
                    )
