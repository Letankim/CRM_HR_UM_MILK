import { SYSTEM_CONFIG } from '@umbm/shared';

export type SopQuestionCategory = 'PHA_CHE' | 'VS_ATTP' | 'PHUC_VU' | 'NOI_QUY_DONG_PHUC';

export interface UmbmSopQuestion {
  id: string;
  category: SopQuestionCategory;
  q: string;
  options: [string, string, string, string];
  answer: number;
}

const PHA_CHE_TOPICS: readonly [string, string, string, string, string][] = [
  ['Nhiệt độ bảo quản sữa tươi thanh trùng chuẩn tại quầy Ụm Bò Milk là bao nhiêu?', 'Từ 2°C đến 6°C', 'Từ 10°C đến 15°C', 'Nhiệt độ phòng 25°C', 'Dưới -5°C'],
  ['Thời gian ủ trà đen tiêu chuẩn cho dòng trà sữa truyền thống là bao nhiêu phút?', '12 phút ở 92°C–95°C', '3 phút ở 60°C', '45 phút đun sôi liên tục', 'Ủ qua đêm 12 giờ'],
  ['Tỷ lệ đá tiêu chuẩn cho ly size M (500ml) khi khách không yêu cầu giảm đá là?', '70% thể tích ly sau khi lắc', '100% đầy tràn miệng ly', '20% thể tích ly', 'Không bỏ đá khi lắc'],
  ['Trân châu đen sau khi luộc chín và ngâm đường chỉ được phép sử dụng trong tối đa bao lâu?', 'Trong vòng 4 giờ ở nhiệt độ phòng ấm', 'Trong vòng 24 giờ', 'Để tủ lạnh dùng 3 ngày', 'Dùng đến khi hết'],
  ['Định lượng sữa tươi tiêu chuẩn cho món Sữa Tươi Trân Châu Đường Đen size L (700ml) là?', '220ml sữa tươi thanh trùng lạnh', '80ml sữa tươi pha nước lọc', '400ml sữa đặc', '100ml kem béo'],
  ['Thao tác bắt buộc trước khi rót sữa tươi thanh trùng ra ca đong là gì?', 'Kiểm tra hạn sử dụng và cảm quan mùi vị, lắc nhẹ đều hộp', 'Đun sôi sữa trên bếp từ', 'Pha thêm 50% nước lọc', 'Mở nắp để ngoài nắng 2 giờ'],
  ['Khi khách gọi món mức đường 50% (Nửa đường), nhân viên pha chế điều chỉnh như thế nào?', 'Nhấn đúng nút 50% trên máy định lượng đường Fructose', 'Bỏ qua bước cho đường', 'Cho gấp đôi lượng sữa đặc', 'Ước lượng bằng mắt thường'],
  ['Thời gian lắc bình shaker tiêu chuẩn để tạo lớp bọt mịn và hòa quyện hương vị là?', 'Lắc dứt khoát 15–20 nhịp (khoảng 8–10 giây)', 'Khuấy nhẹ 1 vòng', 'Lắc liên tục 3 phút', 'Đổ trực tiếp không cần lắc'],
  ['Lớp kem Macchiato đạt chuẩn tại Ụm Bò Milk phải có độ sánh như thế nào?', 'Sánh mịn, chảy thành dòng mượt, nổi đều trên bề mặt trà', 'Loãng như nước lọc, chìm ngay xuống đáy', 'Đông cứng như đá viên', 'Tách lớp dầu và nước'],
  ['Sai số tối đa cho phép khi cân định lượng nguyên liệu bột pha chế là bao nhiêu?', 'Không quá ±1 gram trên cân điện tử', 'Tùy ý đong bằng muỗng canh', 'Sai số ±20 gram', 'Không cần dùng cân'],
];

const VS_ATTP_TOPICS: readonly [string, string, string, string, string][] = [
  ['Nguyên tắc xuất nhập nguyên liệu trong kho và tủ mát Ụm Bò Milk là gì?', 'FIFO (Nhập trước - Xuất trước) và FEFO (Hết hạn trước - Xuất trước)', 'Lấy hộp nào gần tay nhất', 'Nhập sau - Xuất trước', 'Chỉ kiểm tra hạn sử dụng mỗi tháng 1 lần'],
  ['Tần suất vệ sinh và khử khuẩn vòi máy định lượng đường, ca đong, muỗng khuấy trong ca là?', 'Rửa sạch sau mỗi lần thao tác và ngâm khử khuẩn định kỳ 2 giờ/lần', 'Chỉ rửa 1 lần vào cuối tuần', 'Lau khô bằng khăn giấy tái sử dụng', 'Không cần rửa nếu chỉ đong đường'],
  ['Quy định về tem nhãn phụ (Date Tag) dán trên bình nguyên liệu đã mở nắp là gì?', 'Ghi rõ Tên nguyên liệu + Giờ/Ngày mở + Giờ/Ngày hết hạn + Tên NV', 'Chỉ dán giấy trắng không chữ', 'Không cần dán tem nếu nhớ trong đầu', 'Dán tem một lần dùng cả tháng'],
  ['Khi phát hiện hộp sữa tươi có dấu hiệu phồng hộp hoặc chua nhẹ dù còn hạn, xử lý thế nào?', 'Cô lập ngay, lập biên bản hủy hàng hỏng và báo Quản lý cửa hàng', 'Pha thêm đường để át mùi chua', 'Đem đun sôi rồi bán tiếp', 'Dùng pha các món có hương liệu mạnh'],
  ['Quy định rửa tay của nhân viên pha chế theo chuẩn Vệ sinh ATTP gồm mấy bước và khi nào?', 'Rửa tay 6 bước bằng xà phòng diệt khuẩn trước khi vào quầy và sau khi chạm đồ bẩn', 'Chỉ nhúng nước lạnh 1 giây', 'Chỉ rửa tay khi tan ca', 'Lau tay vào tạp dề'],
  ['Khăn lau tại quầy pha chế Ụm Bò Milk được phân màu như thế nào để tránh nhiễm chéo?', 'Phân màu riêng cho mặt bàn quầy bar, vòi máy/dụng cụ và khu vực bồn rửa', 'Dùng chung 1 khăn lau cả sàn nhà và miệng ly', 'Dùng áo đồng phục để lau', 'Không sử dụng khăn lau'],
  ['Nhiệt độ tủ đông bảo quản kem và topping cấp đông tiêu chuẩn là bao nhiêu?', 'Từ -18°C đến -22°C', 'Từ 0°C đến 5°C', 'Từ 8°C đến 12°C', 'Tắt tủ đông vào ban đêm để tiết kiệm điện'],
  ['Bồn rửa và bẫy mỡ tại quầy pha chế phải được vệ sinh tổng kết vào thời điểm nào?', 'Cuối mỗi ca làm việc và tổng vệ sinh khử trùng cuối ngày (Closing)', 'Chỉ vệ sinh khi bị tắc nghẽn tràn nước', 'Mỗi quý 1 lần', 'Giao cho nhân viên giao hàng rửa'],
  ['Quy định đối với móng tay và trang sức của nhân viên đứng quầy pha chế là gì?', 'Cắt ngắn móng tay, không sơn móng, không đeo nhẫn/vòng tay dễ rơi vào đồ uống', 'Được sơn móng tay đính đá hạt lớn', 'Đeo nhiều nhẫn kim loại khi nhào trân châu', 'Để móng tay dài 3cm'],
  ['Nguồn nước dùng cho máy làm đá và đun nước pha trà tại cửa hàng phải đạt chuẩn gì?', 'Qua hệ thống lọc RO đạt chuẩn nước uống trực tiếp và thay lõi đúng hạn', 'Lấy nước giếng chưa lọc', 'Dùng nước mưa dự trữ', 'Không cần kiểm tra hệ thống lọc'],
];

const PHUC_VU_TOPICS: readonly [string, string, string, string, string][] = [
  ['Câu chào tiêu chuẩn khi khách hàng bước vào cửa hàng Ụm Bò Milk là gì?', 'Mỉm cười, giao tiếp ánh mắt và chào: "Dạ Ụm Bò Milk xin chào anh/chị ạ!"', 'Im lặng nhìn điện thoại chờ khách hỏi', 'Chỉ gật đầu không nói gì', 'Hỏi lớn: "Mua gì đọc nhanh lên"'],
  ['Thời gian cam kết hoàn thành 1 ly đồ uống tiêu chuẩn kể từ lúc in bill là bao lâu?', 'Tối đa 90–120 giây cho mỗi đơn 1–2 ly tiêu chuẩn', 'Tối đa 30 phút', 'Khi nào rảnh mới làm', 'Để khách tự vào quầy pha'],
  ['Quy trình 5 bước giao đồ uống tại quầy Pickup chuẩn Ụm Bò Milk là gì?', 'Gọi số bill -> Kiểm đối chiếu món -> Cầm đáy/thân ly giao bằng 2 tay -> Mời khách kiểm tra -> Cảm ơn', 'Đặt mạnh ly xuống bàn không gọi số', 'Cầm vào miệng ly đưa bằng 1 tay', 'Ném ống hút lên mặt bàn'],
  ['Khi khách phản ánh đồ uống bị nhạt hoặc sai mức đường/đá, nhân viên xử lý thế nào?', 'Xin lỗi chân thành, kiểm tra lại bill và hỗ trợ điều chỉnh hoặc pha lại ly mới ngay lập tức', 'Cãi tay đôi với khách rằng máy không thể sai', 'Yêu cầu khách tự mua thêm đường', 'Từ chối giải quyết vì đã in hóa đơn'],
  ['Khi quầy POS có từ 3 khách xếp hàng chờ trở lên, nhân viên cần làm gì?', 'Chào khách đang chờ, xin phép khách thông cảm và gọi hỗ trợ mở thêm điểm tiếp nhận order', 'Bỏ quầy đi vào kho nghỉ ngơi', 'Tắt máy POS ngừng nhận khách', 'Phục vụ khách quen trước, khách lạ sau'],
  ['Trước khi bấm thanh toán và in hóa đơn trên máy POS, thu ngân bắt buộc phải làm gì?', 'Đọc xác nhận lại tên món, size, mức đường/đá, topping và tổng tiền với khách', 'Tự ý bấm thanh toán không hỏi lại', 'Tự thêm topping đắt tiền vào đơn', 'Thu tiền mặt không in hóa đơn'],
  ['Đối với đơn hàng giao qua ứng dụng (GrabFood/ShopeeFood/Be), bước kiểm tra bắt buộc là?', 'Đối chiếu đúng mã đơn, niêm phong nắp ly chống tràn, đủ ống hút và bấm ảnh/kẹp bill chuẩn', 'Giao đại túi bất kỳ cho tài xế', 'Không cần đóng nắp ly', 'Bỏ qua việc kiểm tra số lượng món'],
  ['Khi làm rơi đổ đồ uống ra sàn khu vực khách ngồi, nhân viên xử lý theo thứ tự nào?', 'Đặt biển cảnh báo sàn ướt, xin lỗi và đổi ly mới cho khách (nếu của khách), lau dọn khô sạch ngay', 'Để nguyên vết đổ đến cuối ngày mới lau', 'Yêu cầu khách tự lau dọn', 'Đổ thêm nước ra sàn'],
  ['Thái độ giao tiếp chuẩn mực khi khách hỏi tư vấn món mới tại Ụm Bò Milk là gì?', 'Nhiệt tình giới thiệu hương vị đặc trưng, hỏi khẩu vị ngọt/béo của khách để gợi ý món phù hợp', 'Trả lời: "Tự nhìn menu trên bảng mà chọn"', 'Chỉ giới thiệu món pha nhanh nhất', 'Lắc đầu bảo không biết'],
  ['Khi kết thúc giao dịch tại quầy thu ngân, nhân viên cần nói câu gì?', '"Dạ em gửi hóa đơn, mời anh/chị chờ nhận nước tại quầy Pickup, Ụm Bò Milk cảm ơn ạ!"', 'Quay lưng đi ngay không nói gì', '"Xong rồi tránh ra cho người sau"', 'Chỉ đưa tiền thừa bằng 1 tay'],
];

const NOI_QUY_TOPICS: readonly [string, string, string, string, string][] = [
  ['Cổng điểm danh GPS trên ứng dụng chỉ mở trước giờ bắt đầu ca làm việc bao nhiêu phút?', 'Mở trước giờ bắt đầu ca đúng 30 phút', 'Mở trước 5 giờ sáng cho mọi ca', 'Mở bất kỳ lúc nào trong tuần', 'Chỉ mở sau khi ca đã kết thúc'],
  ['Nếu quá bao nhiêu giờ kể từ giờ bắt đầu ca mà nhân viên chưa Check-IN thì hệ thống tự chuyển ABSENT?', 'Quá 3 giờ kể từ giờ bắt đầu ca chưa Check-IN sẽ tự động chuyển Vắng mặt (ABSENT)', 'Quá 12 giờ đêm', 'Quá 5 phút', 'Không bao giờ chuyển ABSENT'],
  ['Nhân sự Chính thức bắt buộc mặc đồng phục gì khi chụp ảnh Camera điểm danh Vào/Ra ca?', 'Áo phông hồng Ụm Bò Milk + tạp dề + mũ/băng đô gọn gàng (tỷ lệ màu hồng đạt tối thiểu 10% khung hình)', 'Áo khoác đen che kín toàn bộ đồng phục', 'Đồ ngủ ở nhà', 'Không cần mặc đồng phục khi điểm danh'],
  ['Mức phạt đi trễ theo quy định 4 bậc khi nhân viên vào ca trễ từ 6 đến 15 phút (Tầng 1) là?', 'Phạt 15.000đ trực tiếp vào kỳ lương', 'Không bị phạt', 'Phạt 500.000đ', 'Trừ 100% lương cả tháng'],
  ['Mức phạt đi trễ khi nhân viên vào ca trễ từ 16 đến 30 phút (Tầng 2) là bao nhiêu?', 'Phạt 30.000đ', 'Phạt 5.000đ', 'Phạt 10.000đ', 'Không tính phạt'],
  ['Mức phạt đi trễ khi nhân viên vào ca trễ từ 31 đến 45 phút (Tầng 3) là bao nhiêu?', 'Phạt 50.000đ', 'Phạt 15.000đ', 'Phạt 20.000đ', 'Cảnh cáo miệng không trừ tiền'],
  ['Nếu nhân viên vào ca trễ trên 45 phút (Tầng 4) và không có phiếu bổ sung công hợp lệ thì sao?', 'Phạt 50% tiền lương của ca làm việc đó', 'Chỉ nhắc nhở nhẹ', 'Được thưởng thêm phụ cấp', 'Phạt 5.000đ'],
  ['Mỗi lần hoàn thành 1 ca làm việc hợp lệ (Check-IN & Check-OUT đúng quy chuẩn), nhân viên được cộng mấy điểm chuyên cần?', 'Được cộng +2 điểm tích lũy chuyên cần (Attendance Credit)', 'Không được cộng điểm nào', 'Được cộng 100 điểm', 'Bị trừ 1 điểm'],
  ['Để gửi Phiếu bổ sung công cả ngày (FULL_SHIFT) và giới hạn số lần gửi trong tuần là như thế nào?', 'Tối đa 1 phiếu/tuần và cần tiêu tốn 5 điểm tích lũy chuyên cần cho phiếu bù công cả ngày', 'Gửi không giới hạn 20 phiếu/tuần miễn phí', 'Không cần ảnh minh chứng', 'Tự động duyệt ngay không cần HR'],
  ['Phiếu bổ sung công đang ở trạng thái PENDING nếu sau bao nhiêu phút không được phê duyệt sẽ tự động REJECTED?', 'Tự động chuyển sang REJECTED sau 30 phút và xóa vĩnh viễn bản ghi REJECTED sau 7 ngày', 'Giữ nguyên PENDING suốt 1 năm', 'Tự động chuyển sang APPROVED sau 5 phút', 'Xóa ngay sau 10 giây'],
];

const VARIANT_SUFFIXES = [
  'theo quy chuẩn vận hành chuẩn V5.1',
  'áp dụng tại toàn bộ chi nhánh Ụm Bò Milk',
  'trong ca làm việc hàng ngày (Sáng / Chiều / Tối)',
] as const;

export function generateUmbm120Questions(): UmbmSopQuestion[] {
  const bank: UmbmSopQuestion[] = [];
  const groups: readonly { cat: SopQuestionCategory; prefix: string; items: readonly [string, string, string, string, string][] }[] = [
    { cat: 'PHA_CHE', prefix: 'PC', items: PHA_CHE_TOPICS },
    { cat: 'VS_ATTP', prefix: 'ATTP', items: VS_ATTP_TOPICS },
    { cat: 'PHUC_VU', prefix: 'PV', items: PHUC_VU_TOPICS },
    { cat: 'NOI_QUY_DONG_PHUC', prefix: 'NQ', items: NOI_QUY_TOPICS },
  ];
  let seq = 1;
  for (const grp of groups) {
    for (let v = 0; v < 3; v++) {
      const suffix = VARIANT_SUFFIXES[v]!;
      for (let idx = 0; idx < grp.items.length; idx++) {
        const [baseQ, correctOpt, w1, w2, w3] = grp.items[idx]!;
        const ansIdx = (seq - 1) % 4;
        const wrongs = [w1, w2, w3];
        const opts: string[] = [];
        let wPtr = 0;
        for (let slot = 0; slot < 4; slot++) {
          opts.push(slot === ansIdx ? correctOpt : wrongs[wPtr++]!);
        }
        bank.push({
          id: `q${seq}`,
          category: grp.cat,
          q: v === 0 ? baseQ : `[${grp.prefix}-${idx + 1}.${v + 1}] ${baseQ.replace(/\?$/, '')} (${suffix})?`,
          options: opts as [string, string, string, string],
          answer: ansIdx,
        });
        seq++;
      }
    }
  }
  return bank;
}

export const UMBM_120_QUESTIONS: readonly UmbmSopQuestion[] = generateUmbm120Questions();

export function pickRandomExamQuestions<T>(questions: readonly T[], count: number = SYSTEM_CONFIG.defaults.testQuestionsPerExam): T[] {
  if (questions.length <= count) return [...questions];
  const copy = [...questions];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy.slice(0, count);
}
