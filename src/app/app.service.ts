import { HttpStatus, Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as dayjs from 'dayjs';
import { ConfigService } from '@nestjs/config';
import { GeolocationService } from 'src/config/geolocation/geolocation.service';
import { handleResponse } from 'src/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AvatarService } from 'src/config/avatars/avatar.service';
import { AuthHelper } from 'src/helpers';

@Injectable()
export class AppService {
  private logsDir = path.join(__dirname, '..', '..', 'logs');

  constructor(
    private readonly configService: ConfigService,
    private readonly geolocation: GeolocationService,
    private avatar: AvatarService,
    private auth: AuthHelper,
    private prisma: PrismaService,
  ) {}

  async getHello(): Promise<string> {
    // Read the server name from environment variables
    const serverName = this.configService.get<string>('PLATFORM_NAME');
    let location;

    try {
      location = await this.geolocation.getCurrencyRate();
    } catch (error) {
      console.error('Error fetching location:', error);
      location = null;
    }

    return new handleResponse(
      HttpStatus.OK,
      `${serverName} Server is Online`,
      location,
    ).getResponse();
  }

  // Get both .log and .json log files
  async getLogFiles(): Promise<string[]> {
    const files = await fs.readdir(this.logsDir);
    return files.filter(
      (file) => file.endsWith('.log') || file.endsWith('.json'),
    );
  }

  // Read the content of a log or json file
  async getLogFileContent(filename: string): Promise<object[]> {
    const filePath = path.join(this.logsDir, filename);
    const content = await fs.readFile(filePath, 'utf8');

    // Check if the file is a JSON log
    if (filename.endsWith('.json')) {
      // Split and parse the file by lines in case it's line-by-line JSON logging
      return content
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => {
          const log = JSON.parse(line);
          log.timestamp = dayjs(log.timestamp).format(
            'ddd DD, MMMM YYYY - hh:mm:ssa',
          );
          return log;
        });
    }

    // Handle the .log file (assumed to be human-readable logs)
    if (filename.endsWith('.log')) {
      return content
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => {
          const [timestamp, level, ...messageParts] = line.split(' '); // Assuming format: "timestamp [LEVEL]: message"
          const message = messageParts.join(' ').split('\n')[0]; // Rest is the message

          return {
            timestamp: dayjs(timestamp).format('ddd DD, MMMM YYYY - hh:mm:ssa'),
            level: level.replace(/[\[\]]/g, ''), // Remove brackets around the level
            message: message,
          };
        });
    }

    return [];
  }

  // Delete a specific log file
  async deleteLogFile(filename: string): Promise<void> {
    const filePath = path.join(this.logsDir, filename);
    await fs.unlink(filePath);
  }

  // Delete all log files
  async deleteAllLogFiles(): Promise<void> {
    const files = await this.getLogFiles();
    for (const file of files) {
      await this.deleteLogFile(file);
    }
  }

  async checkAndCreateAdmin() {
    const adminUser = await this.prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });

    const avatar = await this.avatar.getRandomAvatar();

    if (!adminUser) {
      // Get environment variables for admin data
      const adminEmail = process.env.ADMIN_EMAIL;
      const adminPassword = process.env.ADMIN_PASSWORD;
      const adminUsername = process.env.ADMIN_USERNAME;
      const adminFirstName = process.env.ADMIN_FIRSTNAME;
      const adminLastName = process.env.ADMIN_LASTNAME;

      // Hash the admin password
      const hashedPassword = await this.auth.hashData(adminPassword);

      // Create the admin user
      await this.prisma.user.create({
        data: {
          email: adminEmail,
          password: hashedPassword,
          confirm_password: hashedPassword,
          username: adminUsername,
          firstname: adminFirstName,
          lastname: adminLastName,
          profilePicture: avatar,
          isActive: true,
          isVerified: true,
          role: 'ADMIN',
        },
      });

      //TODO: send email notification
      return new handleResponse(HttpStatus.OK, 'Admin Created').getResponse();
    }
  }
}
