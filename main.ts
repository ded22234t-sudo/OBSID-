import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, MarkdownView } from 'obsidian';

interface TimeNotifierSettings {
	notificationTime: string;
	notificationMessage: string;
	enabled: boolean;
}

const DEFAULT_SETTINGS: TimeNotifierSettings = {
	notificationTime: '12:00',
	notificationMessage: 'Напоминание!',
	enabled: true
}

export default class LocalTimeNotifier extends Plugin {
	settings: TimeNotifierSettings;
	private timer: NodeJS.Timeout | null = null;
	private nextNotificationTime: Date | null = null;

	async onload() {
		await this.loadSettings();

		// Добавляем иконку в боковую панель
		this.addRibbonIcon('bell', 'Local Notifier', () => {
			new ScheduleNotificationModal(this.app, (dateTime: Date, message: string) => {
				this.scheduleNotification(dateTime, message);
			}).open();
		});

		// Добавляем команду в командную палитру
		this.addCommand({
			id: 'schedule-notification',
			name: 'Запланировать уведомление',
			callback: () => {
				new ScheduleNotificationModal(this.app, (dateTime: Date, message: string) => {
					this.scheduleNotification(dateTime, message);
				}).open();
			}
		});

		// Добавляем команду для быстрого напоминания через 5 минут
		this.addCommand({
			id: 'quick-5min-reminder',
			name: 'Напоминание через 5 минут',
			callback: () => {
				const now = new Date();
				const notifyTime = new Date(now.getTime() + 5 * 60000);
				this.scheduleNotification(notifyTime, 'Напоминание через 5 минут!');
				new Notice(`Уведомление установлено на ${notifyTime.toLocaleTimeString()}`);
			}
		});

		// Добавляем команду для установки напоминания на завтра
		this.addCommand({
			id: 'tomorrow-reminder',
			name: 'Напоминание на завтра в это же время',
			callback: () => {
				const now = new Date();
				const tomorrow = new Date(now.getTime() + 24 * 60 * 60000);
				this.scheduleNotification(tomorrow, 'Ежедневное напоминание');
				new Notice(`Уведомление установлено на завтра (${tomorrow.toLocaleDateString()})`);
			}
		});

		// Вкладка настроек
		this.addSettingTab(new TimeNotifierSettingTab(this.app, this));

		// Восстанавливаем запланированные уведомления при перезагрузке
		this.restoreScheduledNotifications();
		
		console.log('Local Time Notifier загружен');
	}

	onunload() {
		// Очищаем все таймеры при выгрузке
		if (this.timer) {
			clearTimeout(this.timer);
		}
		console.log('Local Time Notifier выгружен');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Основная функция для планирования уведомления
	scheduleNotification(dateTime: Date, message: string): void {
		const now = new Date();
		const delay = dateTime.getTime() - now.getTime();

		if (delay <= 0) {
			new Notice('Пожалуйста, выберите будущее время');
			return;
		}

		// Сохраняем время следующего уведомления
		this.nextNotificationTime = dateTime;

		// Очищаем предыдущий таймер
		if (this.timer) {
			clearTimeout(this.timer);
		}

		// Устанавливаем новый таймер
		this.timer = setTimeout(() => {
			this.showNotification(message);
			this.nextNotificationTime = null;
		}, delay);

		// Сохраняем в localStorage для восстановления при перезагрузке
		this.saveToLocalStorage(dateTime, message);

		new Notice(`Уведомление установлено на ${dateTime.toLocaleString()}`);
	}

	// Показать уведомление
	private showNotification(message: string): void {
		// Используем встроенные уведомления Obsidian
		new Notice(`🔔 ${message}`, 10000); // Показываем 10 секунд

		// Используем Web Notifications API, если доступно и разрешено
		if ('Notification' in window && Notification.permission === 'granted') {
			new Notification('Obsidian', {
				body: message,
				icon: 'https://obsidian.md/favicon.ico'
			});
		}

		// Добавляем запись в активную заметку
		this.appendToActiveNote(message);
	}

	// Добавить запись в активную заметку
	private async appendToActiveNote(message: string): Promise<void> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			const editor = activeView.editor;
			const cursor = editor.getCursor();
			const timestamp = new Date().toLocaleString();
			
			editor.replaceRange(
				`\n- [ ] **${timestamp}**: ${message}`,
				cursor
			);
		}
	}

	// Сохраняем в localStorage для восстановления
	private saveToLocalStorage(dateTime: Date, message: string): void {
		const data = {
			dateTime: dateTime.toISOString(),
			message: message,
			scheduledAt: new Date().toISOString()
		};
		localStorage.setItem('obsidian-time-notifier', JSON.stringify(data));
	}

	// Восстанавливаем уведомления при перезагрузке
	private restoreScheduledNotifications(): void {
		const saved = localStorage.getItem('obsidian-time-notifier');
		if (saved) {
			try {
				const data = JSON.parse(saved);
				const dateTime = new Date(data.dateTime);
				const now = new Date();

				if (dateTime > now) {
					const delay = dateTime.getTime() - now.getTime();
					this.nextNotificationTime = dateTime;

					this.timer = setTimeout(() => {
						this.showNotification(data.message);
						this.nextNotificationTime = null;
						localStorage.removeItem('obsidian-time-notifier');
					}, delay);

					console.log('Восстановлено уведомление на', dateTime);
				} else {
					localStorage.removeItem('obsidian-time-notifier');
				}
			} catch (e) {
				console.error('Ошибка восстановления уведомления:', e);
			}
		}
	}

	// Получить информацию о следующем уведомлении
	getNextNotificationInfo(): string {
		if (this.nextNotificationTime) {
			return `Следующее уведомление: ${this.nextNotificationTime.toLocaleString()}`;
		}
		return 'Нет запланированных уведомлений';
	}
}

// Модальное окно для планирования уведомления
class ScheduleNotificationModal extends Modal {
	result: { date: string; time: string; message: string };
	onSubmit: (dateTime: Date, message: string) => void;

	constructor(app: App, onSubmit: (dateTime: Date, message: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
		
		// Устанавливаем значения по умолчанию
		const now = new Date();
		this.result = {
			date: now.toISOString().split('T')[0],
			time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
			message: 'Напоминание из Obsidian!'
		};
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Запланировать уведомление' });

		// Поле для даты
		new Setting(contentEl)
			.setName('Дата')
			.addText(text => text
				.setPlaceholder('YYYY-MM-DD')
				.setValue(this.result.date)
				.onChange(value => this.result.date = value));

		// Поле для времени
		new Setting(contentEl)
			.setName('Время (24-часовой формат)')
			.addText(text => text
				.setPlaceholder('HH:MM')
				.setValue(this.result.time)
				.onChange(value => this.result.time = value));

		// Поле для сообщения
		new Setting(contentEl)
			.setName('Сообщение')
			.addTextArea(text => text
				.setPlaceholder('Введите текст напоминания...')
				.setValue(this.result.message)
				.onChange(value => this.result.message = value));

		// Кнопки
		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Отмена')
				.onClick(() => this.close()))
			.addButton(btn => btn
				.setButtonText('Установить')
				.setCta()
				.onClick(() => {
					this.close();
					this.schedule();
				}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	schedule() {
		const dateTime = new Date(`${this.result.date}T${this.result.time}`);
		this.onSubmit(dateTime, this.result.message);
	}
}

// Вкладка настроек плагина
class TimeNotifierSettingTab extends PluginSettingTab {
	plugin: LocalTimeNotifier;

	constructor(app: App, plugin: LocalTimeNotifier) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Настройки локальных уведомлений' });

		// Информация о следующем уведомлении
		const infoEl = containerEl.createEl('p', {
			text: this.plugin.getNextNotificationInfo()
		});
		infoEl.addClass('time-notifier-info');

		// Включение/выключение плагина
		new Setting(containerEl)
			.setName('Включить уведомления')
			.setDesc('Активировать систему уведомлений')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enabled)
				.onChange(async (value) => {
					this.plugin.settings.enabled = value;
					await this.plugin.saveSettings();
				}));

		// Кнопка для тестового уведомления
		new Setting(containerEl)
			.setName('Тестовое уведомление')
			.setDesc('Проверить работу уведомлений')
			.addButton(button => button
				.setButtonText('Показать сейчас')
				.onClick(() => {
					new Notice('🔔 Тестовое уведомление!');
					if ('Notification' in window && Notification.permission === 'granted') {
						new Notification('Obsidian', {
							body: 'Тестовое уведомление',
							icon: 'https://obsidian.md/favicon.ico'
						});
					}
				}));

		// Запрос разрешения на уведомления
		if ('Notification' in window && Notification.permission !== 'granted') {
			new Setting(containerEl)
				.setName('Разрешить системные уведомления')
				.setDesc('Для показа уведомлений вне приложения')
				.addButton(button => button
					.setButtonText('Запросить разрешение')
					.onClick(() => {
						Notification.requestPermission().then(permission => {
							if (permission === 'granted') {
								new Notice('Разрешение получено!');
							}
						});
					}));
		}

		// Кнопка отмены всех уведомлений
		new Setting(containerEl)
			.setName('Отменить все уведомления')
			.setDesc('Очистить все запланированные уведомления')
			.addButton(button => button
				.setButtonText('Отменить')
				.setWarning()
				.onClick(() => {
					if (this.plugin.timer) {
						clearTimeout(this.plugin.timer);
						this.plugin.timer = null;
						this.plugin.nextNotificationTime = null;
						localStorage.removeItem('obsidian-time-notifier');
						new Notice('Все уведомления отменены');
						this.display(); // Обновляем интерфейс
					}
				}));
	}
}
